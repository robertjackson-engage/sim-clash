'use strict';
// Ice Pick: par 3, 105 yd, 40 m straight down. A tiebreak arena: one drop shot from a ledge
// just under a summit to a round green 40 m across on an island in a frozen tarn, at the
// bottom of a glacier cirque. Nothing is hidden: no bunkers, no trees in play, scoring
// rings painted round the flag. The ice is `water`, so a ball on it is a miss; the wide snow
// causeway in front of the green, the collar round it, the glacier's tongue behind it (long
// is dry) and the shores are not.
// The cirque is real ground all the way round: rock walls stepping up to a ragged crest
// with three horns, a hanging glacier behind the tarn, a base camp on a snow terrace by the
// east shore, an ice field on a shelf to the west.
// The tarn is two polygons, a lobe of ice either side of the island (the course format has
// no polygons with holes).
// Local metres, x east, y north; the tee is the origin and the hole plays due north.
// Heights are metres above the ice (the ice is exactly 0).

const L = require('../lib');

const RAD = Math.PI / 180;
const TEE = [0, 0];
const PIN = [0, 96];                           // 105 yd
const TEE_H = 42;
const GREEN_R = 20;                            // 40 m across
const ISLAND_R = 30;                           // the green and ten metres of snow round it
const CAUSEWAY = 0.36;                         // half-angle (rad) of the gap towards the tee, seen from the pin
const TONGUE = 0.42;                           // and of the glacier's tongue behind the green
const BANK_M = 4;
const K = [0, 100];                            // the middle of the cirque
const BASIN = [80, 66];                        // the cirque floor's radii: the walls start here
const WALL_M = 48;                             // from the floor to the crest, in plan

// no stray -0 in an outline (it would not survive the trip through JSON)
const tidy = (poly) => poly.map(([x, y]) => [Math.round(x * 1000) / 1000 + 0, Math.round(y * 1000) / 1000 + 0]);
const bell = (t) => { const a = Math.abs(t); return a >= 1 ? 0 : (1 - a * a) * (1 - a * a); };
const turn = (a, b) => ((a - b + 540) % 360) - 180;

// ---- outlines
const basin = L.ellipse(K[0], K[1], BASIN[0], BASIN[1], { n: 96 });
const tarnShore = L.blob(0, 100, 66, 53, { wobble: 0.04, seed: 5, n: 96 });
const shoreR = L.radiusOf(tarnShore, PIN);
// the ice: from the island out to the shore, east and west of it: all the way round but for
// the causeway in front and the glacier's tongue behind
const lobe = (a0, a1) => {
  const outer = [], inner = [], n = 60;
  for (let k = 0; k <= n; k++) {
    const a = L.lerp(a0, a1, k / n);
    outer.push([PIN[0] + shoreR(a) * Math.cos(a), PIN[1] + shoreR(a) * Math.sin(a)]);
    inner.push([PIN[0] + ISLAND_R * Math.cos(a), PIN[1] + ISLAND_R * Math.sin(a)]);
  }
  return tidy(L.ensureCCW([...outer, ...inner.reverse()]));
};
const tarn = [lobe(-Math.PI / 2 + CAUSEWAY, Math.PI / 2 - TONGUE), lobe(Math.PI / 2 + TONGUE, 1.5 * Math.PI - CAUSEWAY)];

// ---- surfaces
const tee = L.rect(-5, -5, 5, 1.5);                   // the ball is a metre and a half from the lip
// the tee's ledge: level where the players stand and either side of them, the lip of the wall a metre in
// front of the ball, and the mountain climbing behind it: the camera stands up there, 14 m back, and looks
// down over the ball at the whole tarn
const ledgeW = (x, y) => (1 - L.smoothstep(14, 22, Math.abs(x))) * (1 - L.smoothstep(1, 3.5, y)) * (1 - L.smoothstep(-19, -29, y));
const ledgeH = (x, y) => TEE_H + 0.7 * L.clamp(-3.5 - y, 0, 13) * (1 - L.smoothstep(6, 11, Math.abs(x)));
// the wall straight below the tee is kept plain, so no crag stands between the players and the green
const below = (x, y) => bell(x / 42) * (1 - L.smoothstep(30, 60, y));
const green = tidy(L.ellipse(PIN[0], PIN[1], GREEN_R, GREEN_R, { n: 64 }));
const camp = L.blob(104, 92, 21, 30, { wobble: 0.05, seed: 31 });            // the base camp's snow terrace
const shelf = L.blob(-100, 112, 16, 25, { wobble: 0.06, seed: 32 });         // the ice field's shelf
const CAMP_H = 6.5, SHELF_H = 5;

// ---- ground
const greenPlane = L.plane(1.7, PIN, 0, 0.010);                             // 1 %, falling to the tee
const snow = L.fbm({ seed: 701, scaleM: 40, octaves: 3 });
const crestN = L.fbm({ seed: 702, scaleM: 60, octaves: 3 });
const cragN = L.fbm({ seed: 703, scaleM: 24, octaves: 3 });
const wallN = L.fbm({ seed: 704, scaleM: 50, octaves: 2 });
const peakN = L.fbm({ seed: 705, scaleM: 90, octaves: 3 });
const SHORE_S = shoreR(-Math.PI / 2);          // from the pin to the near shore
const SHORE_N = shoreR(Math.PI / 2);           // and to the far one
// the crest, by bearing round K (0 east, 90 north): the headwall and a horn either side of it,
// lower shoulders east and west, the tee's summit in the south
const crestH = (deg) => 50 + 8 * crestN(140 * Math.cos(deg * RAD), 140 * Math.sin(deg * RAD)) + 24 * bell(turn(deg, 96) / 22) +
  19 * bell(turn(deg, 38) / 15) + 21 * bell(turn(deg, 147) / 16) + 9 * bell(turn(deg, -160) / 20) + 6 * bell(turn(deg, -20) / 18);

const PADS = [];                               // [x, y, level]: filled in below, once the cirque's own coordinates are defined

function height(x, y) {
  const dx0 = x - K[0], dy0 = y - K[1];
  const deg = Math.atan2(dy0, dx0) / RAD;
  const out = -L.signedDistance(x, y, basin);   // metres outside the cirque floor
  // the floor: snow rolling gently up from the shore
  let h = 2 + 0.35 * snow(x, y) + 0.03 * Math.max(0, out + 14);
  if (out > -8) {
    // the walls: rock stepping up to the crest, then the mountains beyond it
    const plain = 1 - below(x, y);
    const up = L.smoothstep(0, WALL_M, out + 7 * wallN(x, y) * plain);
    let top = crestH(deg) + 5 * cragN(x, y) * up * plain;
    top += 7 * peakN(x, y) * L.smoothstep(WALL_M, WALL_M + 50, out);        // the range behind
    // the hanging glacier: a trough in the headwall straight behind the green
    top -= 24 * bell((x - 6) / 30) * L.smoothstep(150, 185, y) * (1 - 0.5 * L.smoothstep(230, 290, y));
    let wall = L.lerp(h, top, up);
    const band = 9;                             // rock bands: the walls step rather than roll
    wall = L.lerp(wall, Math.round(wall / band) * band, 0.34 * up * (1 - bell((x - 6) / 34) * L.smoothstep(150, 185, y)));
    h = wall;
  }
  // the terraces cut into the walls: base camp to the east, the ice field's shelf to the west
  const onCamp = L.plateauWeight(x, y, camp, 9);
  if (onCamp) h = L.lerp(h, CAMP_H + 0.2 * snow(x * 2, y * 2), onCamp);
  const onShelf = L.plateauWeight(x, y, shelf, 8);
  if (onShelf) h = L.lerp(h, SHELF_H + 0.3 * snow(x * 2, y * 2), onShelf);
  // level ground under the fortress and the dragon, so neither hangs off the crest
  for (const [px, py, level] of PADS) {
    const w = L.smoothstep(21, 10, Math.hypot(x - px, y - py));
    if (w) h = L.lerp(h, level, w);
  }
  // the tee: a ledge under the summit
  const pad = ledgeW(x, y);
  if (pad) h = L.lerp(h, ledgeH(x, y), pad);

  const dx = x - PIN[0], dy = y - PIN[1], r = Math.hypot(dx, dy);
  const inTarn = L.signedDistance(x, y, tarnShore);             // + inside the shore line
  if (r < ISLAND_R + BANK_M + 1) {
    // the island: a tilted top with a short bank down to the ice
    h = greenPlane(x, y) * (1 - L.smoothstep(0, BANK_M, r - ISLAND_R));
  } else if (inTarn > 0) {
    h = L.lerp(h, 0, L.smoothstep(0, BANK_M, inTarn));
  }
  // the causeway: a snow bank from the near shore to the island
  if (dy < 0 && r > ISLAND_R - 1 && r < SHORE_S + 6) {
    const half = r * Math.sin(CAUSEWAY);
    const top = L.lerp(greenPlane(x, y), 1.9, L.smoothstep(ISLAND_R, SHORE_S, r));
    h = Math.max(h, top * (1 - L.smoothstep(0.7 * half, 1.5 * half, Math.abs(dx))));
  }
  // the glacier's tongue: the same behind the green, rising a little to the far shore
  if (dy > 0 && r > ISLAND_R - 1 && r < SHORE_N + 6) {
    const half = r * Math.sin(TONGUE);
    const top = L.lerp(greenPlane(x, y), 3.2, L.smoothstep(ISLAND_R, SHORE_N, r));
    h = Math.max(h, top * (1 - L.smoothstep(0.7 * half, 1.5 * half, Math.abs(dx))));
  }
  return h;
}
// a point on the cirque: deg round K, `out` metres outside the floor's edge
const at = (deg, out) => {
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  const n = Math.hypot(c / BASIN[0], s / BASIN[1]);
  return [K[0] + BASIN[0] * c + out * (c / BASIN[0]) / n, K[1] + BASIN[1] * s + out * (s / BASIN[1]) / n];
};

const FORTRESS = at(38, WALL_M + 4), DRAGON = at(147, WALL_M + 2);
PADS.push([...FORTRESS, crestH(38) - 2], [...DRAGON, crestH(147) - 2]);

// pines up the lower walls of the cirque, none anywhere near the shot and none above the tree line
const glades = L.fbm({ seed: 711, scaleM: 45, octaves: 2 });
const trees = L.scatterTrees(L.rect(-185, -75, 185, 290), {
  spacing: 15, seed: 71, clearM: 4,
  avoid: [L.rect(-56, -30, 56, 175), camp, shelf],
  keep: (x, y) => glades(x, y) > -0.2 && height(x, y) > 3 && height(x, y) < 40 && L.signedDistance(x, y, tarnShore) < -5,
});

// ---- props
const P = (kind, x, y, heightM, rotDeg = 0) => L.prop(kind, x, y, { heightM, rotDeg });
const toPin = (x, y) => L.facing(x, y, PIN[0], PIN[1]);
const ring = (diameterM) => L.prop('target-ring', PIN[0], PIN[1], { heightM: diameterM, id: `ring-${diameterM}` });
const props = [
  // the target: rings 6, 14, 22, 30 and 38 m across, centred on the flag
  ring(6), ring(14), ring(22), ring(30), ring(38),
];

// the summit: prayer flags at the lip, the summit hut and a stone climber on the ridge behind
props.push(
  // (nothing tall within 10 m of the ball's line: the address camera looks straight down it at the tarn)
  P('flag-banner', -10.5, 0, 6, 0), P('flag-banner', 10.5, 0, 6, 0), P('flag-banner', -16, -2, 5, 40), P('flag-banner', 16, -2, 5, 320),
  P('cabin', -30, -22, 7, L.facing(-30, -22, 0, 0)),
  P('statue', 27, -24, 11, L.facing(27, -24, 0, 60)),
  P('torch', -9, -8, 3, 0), P('torch', 9, -8, 3, 0),
  P('snowman', 11, -3, 2.2, 340), P('snowman', -11, -4, 1.9, 20),
  P('ice-spire', -52, -34, 22, 30), P('ice-spire', 50, -40, 26, 200), P('ice-spire', -16, -52, 16, 110),
);

// base camp on the east terrace: cabins at the back, the gallery at the front, a fire, a lookout
const campAt = (dxm, dym) => [104 + dxm, 92 + dym];
props.push(
  ...[[10, -20, 7], [13, -8, 8], [14, 5, 7.5], [11, 17, 7], [-2, 24, 6.5]].map(([a, b, h]) => { const [x, y] = campAt(a, b); return P('cabin', x, y, h, toPin(x, y)); }),
  ...[[-13, -10, 4.2], [-13, 10, 4.2]].map(([a, b, h]) => { const [x, y] = campAt(a, b); return P('crowd', x, y, h, L.facing(x, y, x - 40, y)); }),
  ...[[-17, -21], [-18.5, -7], [-18.5, 6.5], [-16, 20], [0, -26], [3, 27]].map(([a, b]) => { const [x, y] = campAt(a, b); return P('flag-banner', x, y, 7, toPin(x, y)); }),
  P('gate', ...campAt(-4, -24), 8, 250),
  P('tower', ...campAt(16, -27), 15, 0),
  P('torch', ...campAt(0, -5), 3.2, 0), P('torch', ...campAt(1, 8), 3.2, 0), P('torch', ...campAt(-6, 2), 2.8, 0),
  P('snowman', ...campAt(-7, -9), 2.3, 250), P('snowman', ...campAt(-8, 9), 2, 280), P('snowman', ...campAt(4, 15), 2.2, 200), P('snowman', ...campAt(5, -14), 2.4, 300),
  P('pine', ...campAt(22, -16), 19, 10), P('pine', ...campAt(24, 0), 22, 150), P('pine', ...campAt(22, 14), 18, 240), P('pine', ...campAt(8, 31), 20, 80), P('pine', ...campAt(14, -34), 21, 300),
);

// the ice field on the west shelf: spires and crystal clusters
const shelfAt = (dxm, dym) => [-100 + dxm, 112 + dym];
props.push(
  ...[[-6, -17, 12], [3, -10, 8], [-8, -3, 15], [4, 4, 10], [-5, 11, 18], [6, 16, 9], [-9, 19, 13], [9, -19, 7]].map(([a, b, h], i) => P('ice-spire', ...shelfAt(a, b), h, i * 47)),
  ...[[10, -6, 4], [8, 9, 5.5], [-1, -14, 3.5], [0, 8, 4.5], [11, 2, 3], [-3, 0, 6], [2, 20, 4], [12, -13, 5]].map(([a, b, h], i) => P('crystal', ...shelfAt(a, b), h, i * 71)),
);

props.push(
  // seracs down the hanging glacier, straight behind the green
  ...[[-14, 170, 11], [8, 174, 14], [22, 181, 10], [-4, 186, 18], [-22, 192, 13], [12, 196, 21], [-10, 204, 16], [26, 208, 12],
    [2, 216, 24], [-20, 222, 15], [16, 228, 19], [-4, 238, 22], [10, 250, 17], [-14, 256, 20]].map(([x, y, h], i) => P('ice-spire', x, y, h, i * 53)),
  // spires standing in the ice at the corners of the tarn, well wide of the shot
  P('ice-spire', -50, 122, 9, 20), P('ice-spire', 51, 124, 10, 140), P('ice-spire', -38, 140, 7, 260), P('ice-spire', 36, 142, 8, 60),
  P('ice-spire', -57, 84, 6, 320), P('ice-spire', 57, 82, 6.5, 200), P('ice-spire', -30, 146, 11, 90), P('ice-spire', 28, 147, 7, 10),
  // crystal clusters on the island's collar and on the shores either side of the causeway
  ...[[35, 27.5, 3.2], [50, 27, 2.2], [130, 27.5, 3], [145, 27, 2], [215, 28, 2.6], [325, 28, 2.8]].map(([a, r, h]) => P('crystal', PIN[0] + r * Math.cos(a * RAD), PIN[1] + r * Math.sin(a * RAD), h, a)),
  P('crystal', -40, 44, 5, 20), P('crystal', -44, 41, 3, 80), P('crystal', -36, 40, 3.6, 140), P('crystal', 41, 43, 4.6, 200), P('crystal', 45, 40, 3, 260), P('crystal', 37, 40, 3.4, 320),
  // the gallery on the near shore, either side of the causeway, and snowmen along the water
  P('crowd', -28, 38, 3.4, L.facing(-28, 38, -28, 90)), P('crowd', 28, 38, 3.4, L.facing(28, 38, 28, 90)),
  // and on the far shore, under the glacier: flags, fires, two cabins by the west bank
  P('crowd', -38, 161, 3, L.facing(-38, 161, -38, 100)), P('crowd', 38, 161, 3, L.facing(38, 161, 38, 100)),
  ...[[-22, 159], [22, 159], [-54, 153], [54, 153], [-66, 140], [66, 140]].map(([x, y]) => P('flag-banner', x, y, 7, toPin(x, y))),
  P('torch', -14, 157, 3, 0), P('torch', 14, 157, 3, 0),
  P('cabin', -70, 156, 6.5, toPin(-70, 156)), P('cabin', -82, 142, 7, toPin(-82, 142)),
  P('snowman', -12, 50, 2, 20), P('snowman', 12, 50, 2.2, 340),
  P('snowman', -17, 43, 2.1, 30), P('snowman', 17, 43, 2.3, 330), P('snowman', -9, 152, 2.2, 170), P('snowman', 9, 153, 2, 190),
  P('snowman', -71, 78, 2.4, 90), P('snowman', 72, 132, 2.1, 270),
  // tall pines framing the shores
  P('pine', -62, 42, 21, 300), P('pine', 64, 40, 22, 45), P('pine', -74, 150, 24, 120), P('pine', 72, 154, 23, 210),
  P('pine', -30, 162, 22, 330), P('pine', 34, 164, 24, 70), P('pine', -78, 62, 19, 10), P('pine', 80, 60, 20, 150),
  P('pine', -58, 30, 18, 200), P('pine', 56, 28, 19, 20),
  // ice falls on the headwall either side of the glacier: curtains of spires
  ...[[-58, 176, 16], [-50, 181, 22], [-44, 174, 12], [-62, 186, 19], [54, 175, 14], [62, 180, 21], [48, 183, 17], [66, 190, 13]].map(([x, y, h], i) => P('ice-spire', x, y, h, i * 41)),
  // on the crest: a fortress on the north-east horn, watchtowers on the shoulders, a dragon on the north-west horn
  P('castle', ...FORTRESS, 34, toPin(...FORTRESS)),
  P('dragon', ...DRAGON, 24, toPin(...DRAGON)),
  (() => { const [x, y] = at(-18, WALL_M + 2); return P('tower', x, y, 20, toPin(x, y)); })(),
  (() => { const [x, y] = at(196, WALL_M + 2); return P('tower', x, y, 18, toPin(x, y)); })(),
  // ice needles along the crest, all the way round
  ...[[8, 24], [22, 30], [56, 34], [72, 26], [118, 30], [130, 36], [164, 28], [178, 22], [212, 26], [228, 20], [312, 22], [330, 26]]
    .map(([deg, h], i) => { const [x, y] = at(deg, WALL_M + 8 + (i % 3) * 5); return P('ice-spire', x, y, h, i * 61); }),
  // overhead
  P('balloon', -80, 250, 20, 0), P('balloon', 70, 280, 22, 0), P('balloon', -160, 110, 18, 0), P('balloon', 150, 40, 21, 0),
  P('cloud', -210, 330, 44, 0), P('cloud', 170, 350, 50, 0), P('cloud', 20, 400, 56, 0), P('cloud', -260, 140, 40, 0), P('cloud', 250, 170, 46, 0),
  P('bird-flock', -40, 190, 14, 40), P('bird-flock', 90, 150, 12, 300), P('bird-flock', 99, 40, 12, 120),
);

// ---- gadgets (docs/gadgets.md): sudden death stays pure. Nothing here touches the ball:
// only a coin trail along the flight that finishes by the flag (collect all 6 for the bonus).
const flagFlight = L.flight(height, TEE, PIN, { speedMph: 68, vla: 32, spin: 10500 });
const gadgets = [
  flagFlight.coins('summit-coins', 20, Math.floor(flagFlight.carryM) - 8, 6, { reach: 4 }),
];

module.exports = {
  id: 'ice-pick',
  extent: { minX: -200, minY: -90, maxX: 200, maxY: 300 },
  hole: {
    par: 3,
    name: 'Ice Pick',
    line: [TEE, PIN],
    note: 'One hundred and five yards and forty metres straight down to a green on a frozen tarn. It plays 25 yards short: a soft wedge. Short and long are snow; the ice either side is a miss.',
    greenNote: 'Round, 40 metres across and almost level, tilted a touch towards the tee. Rings every four metres from the flag.',
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    { kind: 'green', poly: green },
    ...tarn.map((poly) => ({ kind: 'water', poly })),
  ],
  trees,
  woods: [],
  props,
  gadgets,
  obLine: L.rect(-190, -80, 190, 290),
  height,
  sea: false,
  probes: [
    { at: [-42, 100], kind: 'water', what: 'the ice left of the green' },
    { at: [42, 100], kind: 'water', what: 'the ice right of the green' },
    { at: [0, 136], kind: 'rough', what: 'the tongue of the glacier behind the green: long is dry' },
    { at: [-40, 128], kind: 'water', what: 'the ice long and left' },
    { at: [40, 128], kind: 'water', what: 'the ice long and right' },
    { at: [-30, 58], kind: 'water', what: 'the ice short and left' },
    { at: [30, 58], kind: 'water', what: 'the ice short and right' },
    { at: [0, 56], kind: 'rough', what: 'the causeway' },
    { at: [0, 121], kind: 'rough', what: 'the collar behind the green' },
    { at: [25, 96], kind: 'rough', what: 'the collar right of the green' },
    { at: [0, 30], kind: 'rough', what: 'the wall below the tee' },
    { at: [0, 160], kind: 'rough', what: 'the far shore, under the glacier' },
    { at: [100, 92], kind: 'rough', what: 'base camp' },
    { at: [-100, 112], kind: 'rough', what: 'the ice field\'s shelf' },
    { at: [-198, 100], kind: 'ob', what: 'over the west crest' },
  ],
  stage: {
    number: 23, role: 'tiebreak', order: 3,
    name: 'Ice Pick', theme: 'alpine',
    origin: { lat: 56.0, lon: -146.0 },          // open Gulf of Alaska
    conditions: 'calm',
    baseM: 2300,
    wind: { min: 5, max: 14 },                   // up on the mountain: a read, not a lottery
    timeOfDay: 'golden',
    blurb: 'Sudden death off the summit: 40 metres straight down onto a bullseye on the ice.',
    difficulty: 1,
  },
  // for the tests: the shape of the cirque
  cirque: { centre: K, basin: BASIN, wallM: WALL_M, teeH: TEE_H, campH: CAMP_H, shelfH: SHELF_H, crestH, at },
};
