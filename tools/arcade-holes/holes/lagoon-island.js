'use strict';
// Lagoon Island: par 3, 151 yd, 13 m downhill. From a rock headland over a lagoon to a
// wide island green. A sandbar curls round the lagoon's east side from the harbour to the
// island; Skull Rock, a 60 m stack, stands in the lagoon's mouth left of the line and hides
// the left of the green from the tee. Three ways to play it (hole.routes):
//   SAFE    Turtle Bar: down to the sandbar on the right (no water to carry: a grass bank
//           runs from the tee to the harbour), then a pitch along the bar to the green.
//   RISKY   the Lagoon: straight at the flag, all carry. Skull Rock is 6 m left of the
//           line and the flag is on the left half of the green.
//   ROCKET  Over Skull Rock: only a boosted ball clears it (its crown is 31 to 48 m above the tee),
//           and behind it lies the fat, hidden left lobe of the green.
// Local metres, x east, y north; the tee is the origin. Heights are metres above the sea
// (the sea is exactly 0, see docs/arcade-holes.md).

const L = require('../lib');
const D = require('../detail-a');

const TEE = [0, 0];
const PIN = [-14, 137.4];                      // 151 yd, bearing -6 degrees
const ISLAND = [-14, 139];
const TEE_H = 22;
const GREEN_H = 9;
const SKULL = [-29, 84, 13.5];                 // Skull Rock: x, y, radius
const SKULL_H = TEE_H + 40;                    // its crown slants from 48 m above the tee (west) to 31 m (east)

// ---- land
const mainland = L.smoothPolygon([
  [-320, -200], [320, -200], [320, -44], [170, -36], [112, -30], [84, -16], [74, 6], [50, 14], [28, 13], [16, 20],
  [-10, 22], [-23, 12], [-29, -6], [-40, -28], [-80, -38], [-150, -32], [-320, -38],
], 2);
const teeRock = L.blob(0, 1, 14, 12, { wobble: 0.06, seed: 11 });
const BANK = [[4, 7], [16, 26], [30, 47]];                        // the grass bank from the tee down to the bar
const bank = L.capsule(BANK, [20, 24, 26]);
const BAR = [[58, -4], [56, 40], [50, 80], [37, 114], [14, 133]];
const bar = L.capsule(BAR, [66, 70, 66, 46, 34]);                // the sandbar, harbour to island
const islandTop = L.blob(ISLAND[0], ISLAND[1], 34, 24, { wobble: 0.05, seed: 5, n: 60 });
const monkey = L.blob(205, 170, 62, 118, { wobble: 0.1, seed: 23, n: 60 });   // Monkey Island, across the channel
// rocks awash: [x, y, radius, height]. Under 1.4 m: the sea finder counts them as shore (a
// penalty area), so none is a place to drop a ball or play one from.
const reefs = [[-58, 46, 4.5, 1.3], [-80, 150, 5, 1.3], [-60, 196, 6, 1.3], [-42, 205, 4.5, 1.3], [-66, 106, 4, 1.2], [8, 60, 3.5, 1.1], [-4, 192, 4.5, 1.25]];
// sea stacks, sheer and far from play, their crowns slanted (cliff all over: no place for a ball): [x, y, radius, height]
const stacks = [[-74, 222, 10, 30], [34, 238, 8, 22], [-136, 168, 9, 26], [-150, 60, 8, 18], [86, 262, 9, 24], [-20, 280, 7, 16]];

// ---- surfaces
const tee = L.rect(-6, -5, 6, 5);
const green = L.blob(-17, 138, 25, 16, { wobble: 0.05, seed: 3 });           // 50 x 32 m
const pad = L.capsule([[50, 68], [44, 88], [36, 112], [24, 127]], [42, 40, 24, 13]);   // Turtle Bar's mown top, and the path on to the green
const beach = L.blob(-14, 115.5, 23, 6.5, { wobble: 0.05, seed: 21 });       // plays as sand
const barBeach = L.capsule(D.beside([[56, 30], [50, 80], [40, 106]], 5, 29), 8);   // the bar's lagoon shore: sand
const bunkers = [
  beach,
  L.blob(15, 147, 5.5, 5, { wobble: 0.08, seed: 9 }),                        // the pot, right of the green
  L.blob(-6, 158.5, 8, 3.2, { wobble: 0.08, seed: 10 }),                     // behind the flag
  barBeach,
];

// ---- ground
const sdMain = D.sdf(mainland, 12), sdRock = D.sdf(teeRock, 10), sdBank = D.sdf(bank, 12), sdBar = D.sdf(bar, 10);
const sdIsle = D.sdf(islandTop, 10), sdMonkey = D.sdf(monkey, 60), sdBeach = D.sdf(beach, 8);
const sdBunkers = bunkers.slice(1).map((b) => D.sdf(b, 6));
const greenPlane = L.plane(GREEN_H, [-17, 138], 0.004, 0.012);               // 1.3 %, falling to the tee
const roll = L.fbm({ seed: 101, scaleM: 55, octaves: 3 });
const rockNoise = L.fbm({ seed: 102, scaleM: 14, octaves: 2 });
const bankAt = (x, y) => L.clamp(((x - 8) * 22 + (y - 13) * 34) / (22 * 22 + 34 * 34), 0, 1);
// a dune along the bar's seaward (east) edge: balls that run through the bar stop against it
const berm = L.capsule([[85, 30], [80, 80], [62, 116]], 9);
const sdBerm = D.sdf(berm, 8);

function height(x, y) {
  let h = 0;
  // the mainland: jungle hills climbing behind the tee, and the rock the tee stands on
  const shore = L.smoothstep(0, 7, sdMain(x, y));
  if (shore) {
    const hills = 5.2 + 0.6 * roll(x, y) + (30 + 6 * roll(x + 50, y)) * L.smoothstep(-52, -150, y);
    h = shore * L.lerp(hills, TEE_H, D.inside(sdRock(x, y), 7));
  }
  // the bank: grass, 41 %, from the tee down to the bar (a topped ball rolls down it)
  const onBank = D.inside(sdBank(x, y), 7);
  if (onBank) h = Math.max(h, onBank * L.lerp(TEE_H, 5.2, bankAt(x, y)));
  // the sandbar
  const onBar = L.smoothstep(0, 7, sdBar(x, y));
  if (onBar) h = Math.max(h, onBar * (5 + 0.25 * roll(x * 2, y * 2) + (GREEN_H - 5) * L.clamp((y - 98) / 30, 0, 1) + 1.8 * D.inside(sdBerm(x, y), 3)));
  // the island: a tilted top, nine metres of rock down to the water, a low beach in front
  const top = L.smoothstep(-6, 0, sdIsle(x, y));
  if (top) h = Math.max(h, top * greenPlane(x, y));
  const sand = L.smoothstep(-5, 0, sdBeach(x, y));
  if (sand) h = Math.max(h, 1.1 * sand);
  for (const sd of sdBunkers) {
    const s = sd(x, y);
    if (s > 0) h -= 0.45 * L.smoothstep(0, 3, s);
  }
  // Skull Rock: a sheer monolith, taller than any plain ball flies
  const q = Math.hypot(x - SKULL[0], y - SKULL[1]), a = Math.atan2(y - SKULL[1], x - SKULL[0]);
  const r = SKULL[2] + 1.2 * Math.sin(3 * a + 1) + 0.8 * Math.sin(5 * a);
  // (its crown is a steep slant, not a table: nowhere on it is a place to drop or play a ball)
  if (q < r) h = Math.max(h, (SKULL_H - 0.85 * (x - SKULL[0]) + 1.2 * rockNoise(x, y)) * L.smoothstep(r, r - 2.4, q));
  // Monkey Island: a jungle ridge across the channel
  const far = sdMonkey(x, y);
  if (far > 0) h = Math.max(h, L.smoothstep(0, 9, far) * (9 + 26 * L.clamp(far / 58, 0, 1) + 3 * roll(x, y + 200)));
  for (const [cx, cy, rr, t] of reefs) h = Math.max(h, t * L.bump(x, y, cx, cy, rr));
  for (const [cx, cy, rr, t] of stacks) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < rr) h = Math.max(h, (t + 0.9 * (x - cx)) * L.smoothstep(rr, rr - 2.2, d));
  }
  return h;
}

const surfaces = [
  { kind: 'tee', poly: tee },
  { kind: 'green', poly: green },
  { kind: 'fairway', poly: pad },
  ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
];

// jungle: massed behind the tee and over Monkey Island, a grove at the harbour
const firm = (x, y) => height(x, y) > 4.6 && D.slopeOf(height, x, y) < 0.3;
const trees = D.cleanTrees([
  ...L.scatterTrees(L.rect(-216, -78, 276, -46), { spacing: 12, seed: 31 }),
  ...L.scatterTrees(monkey, { spacing: 18, seed: 33 }),
  ...L.clusterTrees(96, -22, { count: 6, radius: 12, seed: 34 }),
  ...L.clusterTrees(-70, -52, { count: 6, radius: 12, seed: 35 }),
], { surfaces, tee: TEE, pin: PIN, clearM: 6, lineM: 22, ok: firm });

// ---- props
const P = D.P;
const face = (kind, x, y, heightM, to) => P(kind, x, y, heightM, L.facing(x, y, to[0], to[1]));
const palms = (pts, seed) => { const rnd = L.mulberry32(seed); return pts.map(([x, y]) => P('palm', x, y, 7.5 + 3.5 * rnd(), 360 * rnd())); };
const props = D.clean([
  // palms: round the tee, down the bank, along the bar's sheltered side, the island's back edge
  ...palms([[-12, 9], [12, 10], [-17, -9], [16, -12], [-12, -22], [13, -25], [-32, -40], [34, -42], [-52, -44], [60, -34], [88, -30], [-96, -44]], 1),
  ...palms(D.beside(BAR, 12, -25), 4), ...palms([[72, 48], [76, 20], [70, -8], [34, 20], [31, 34], [29, 104], [22, 116]], 5),
  ...palms([[-43, 151], [-37, 157], [-26, 160], [8, 160], [15, 156], [18, 132], [-46, 144], [-47, 132]], 6),
  ...D.scatter('palm', { x: 150, y: 170, r: 10, ry: 100 }, 14, { h: [8, 12], seed: 7, minGap: 9 }),
  // the harbour at the root of the bar: huts, tikis, a jetty, boats
  face('hut', 70, 6, 5, [100, 6]), face('hut', 66, -8, 5.5, [100, -8]), face('hut', 74, 22, 5, [100, 22]), face('hut', 62, 20, 4.5, [20, 60]),
  face('hut', 80, -10, 5, [100, -30]), face('hut', 58, -18, 5, [0, 0]), face('hut', 92, -22, 4.5, [120, 20]),
  face('tiki', 60, 8, 4, [30, 30]), face('tiki', 79, 30, 3.5, [30, 60]), face('tiki', 50, 20, 3.5, [0, 0]), face('tiki', 76, 36, 3.5, [100, 40]),
  P('bridge', 96, 14, 34, 90), P('bridge', 90, 44, 22, 70),
  P('boat', 104, 2, 4, 20), P('boat', 110, 26, 4.5, 160), P('boat', 94, 60, 4, 60), P('boat', 120, 50, 5, 110), P('boat', 88, 84, 3.5, 200),
  P('boat', 124, -6, 4, 250), P('boat', 82, 110, 4, 320),
  ...D.beside(BANK, 5, 9).map(([x, y]) => P('torch', x, y, 2.8, 0)), ...D.beside(BANK, 5, -9).map(([x, y]) => P('torch', x, y, 2.8, 0)),
  // an idol on Skull Rock, tikis guarding the green, a shrine behind it
  face('idol', SKULL[0], SKULL[1], 9, TEE), face('tiki', -45, 150, 4.5, PIN), face('tiki', 19, 152, 4.5, PIN), face('tiki', -30, 161, 4, PIN), face('tiki', 4, 162, 4, PIN),
  face('statue', -10, 163, 5, TEE),
  // Monkey Island: a waterfall off the ridge, huts on stilts along the channel, a lookout
  face('waterfall', 176, 150, 34, [100, 150]), face('waterfall', 184, 236, 26, [110, 250]), P('giant-tree', 212, 180, 28, 0), P('tower', 206, 110, 14, 0),
  face('hut', 140, 96, 5, [100, 96]), face('hut', 138, 122, 5, [100, 122]), face('hut', 141, 200, 5, [100, 200]), face('hut', 143, 228, 5, [100, 228]), face('hut', 146, 252, 4.5, [100, 252]),
  P('bridge', 134, 160, 20, 90), P('boat', 126, 140, 4, 10), P('boat', 128, 184, 4.5, 170), P('boat', 130, 214, 4, 30),
  face('temple', 236, 250, 22, TEE), P('ruins', 190, 80, 8, 200),
  // the event: banners along the bar, crowds and a stand on the mainland shore, a screen on the water
  ...D.beside([[52, 42], [48, 82], [37, 112]], 5, -24).map(([x, y]) => P('flag-banner', x, y, 6, 0)),
  P('flag-banner', -11, 8, 5, 0), P('flag-banner', 11, 6, 5, 0),
  face('crowd', 100, -46, 3, [40, 80]), face('crowd', -66, -48, 3, [-14, 137]), face('grandstand', 132, -46, 9, [20, 100]), face('crowd', 40, -42, 3, [0, 60]),
  face('jumbotron', -60, 196, 14, TEE),
  // out in the lagoon and beyond: sails, needles, the volcano on the horizon and its neighbour
  P('boat', -110, 110, 12, 300), P('boat', -170, 220, 16, 250), P('boat', 40, 300, 14, 280), P('boat', -220, 20, 14, 320), P('boat', 110, 320, 12, 200),
  P('shipwreck', -80, 152, 10, 60),
  P('rock-spire', -84, 232, 16, 30), P('rock-spire', 42, 246, 12, 120), P('rock-spire', -146, 160, 14, 200), P('rock-spire', -124, 178, 10, 60), P('rock-spire', 96, 270, 12, 300),
  P('volcano', -60, 760, 150, 0), P('volcano', 420, 640, 110, 40),
  // in the air
  P('bird-flock', -96, 83, 8, 20), P('bird-flock', -74, 222, 8, 200), P('bird-flock', 150, 120, 8, 110), P('bird-flock', 85, 23, 8, 300), P('bird-flock', -120, 60, 8, 50),
  P('bird-flock', 205, 200, 8, 0),
  P('cloud', -200, 300, 46, 0), P('cloud', 120, 420, 50, 0), P('cloud', 300, 200, 44, 0), P('cloud', -320, 120, 54, 0), P('cloud', -40, 560, 60, 0), P('cloud', 240, -60, 40, 0),
  P('balloon', -100, 190, 22, 0), P('balloon', 90, 220, 22, 60), P('fireworks', -50, 190, 30, 0), P('fireworks', 20, 196, 30, 0),
], { surfaces, tee: TEE, pin: PIN, dry: firm });

// ---- gadgets (docs/gadgets.md): what a swing can hit
//   SAFE    the Bar Runner, a speed strip on Turtle Bar's path, runs a lay-up on toward the
//           island (gently: it leaves the ball on the green's east side, not through it).
//   RISKY   the flag is a bullseye: land the tee shot inside 10 m of it for x2, inside 4.5 m
//           for x3. The Turtle Shell, a pad on the beach, throws a ball that came up short
//           on to the green; the Sea Wall behind the island takes the pace off a long one.
//   ROCKET  coins over the crown of Skull Rock, along the Rocket lob's flight.
const skullLob = L.flight(height, TEE, [-34, 138], { speedMph: 68, vla: 32, spin: 10500, ball: 'rocket' });
const gadgets = [
  L.gadget('strip', 'bar-runner', 47, 94, { size: [18, 26], heading: L.bearing([50, 82], [34, 112]), strength: 6, maxMps: 8 }),
  L.gadget('zone', 'flag-x2', PIN[0], PIN[1], { radius: 10, mult: 2 }),
  L.gadget('zone', 'flag-x3', PIN[0], PIN[1], { radius: 4.5, mult: 3 }),
  L.gadget('pad', 'turtle-shell', -13, 116.5, { radius: 4, heading: 0, angle: 55, minMps: 10, maxMps: 12 }),   // onto the front of the green: a putt, not a tap-in
  L.gadget('backboard', 'sea-wall', -14, 160.5, { size: [34, 14], heading: 180, strength: 0.2 }),
  skullLob.coins('skull-coins', 30, 110, 6),
];

module.exports = {
  id: 'lagoon-island',
  stage: {
    number: 1, role: 'match', order: 1,
    name: 'Lagoon Island', theme: 'tropical',
    origin: { lat: 18.5, lon: -140.0 },
    wind: { min: 2, max: 9 },
    timeOfDay: 'day',
    blurb: 'Over the lagoon to an island green: round by the sandbar, or a Rocket over Skull Rock.',
    difficulty: 1,
  },
  extent: { minX: -230, minY: -80, maxX: 290, maxY: 330 },
  hole: {
    par: 3,
    name: 'Lagoon Island',
    line: [TEE, PIN],
    note: 'From the headland, 13 metres down and 151 yards over the lagoon: it plays a club shorter. The beach in front is sand; short, long and left are wet. The sandbar on the right is dry all the way.',
    greenNote: 'Fifty metres wide, tilted towards the tee. The flag is on the left, where Skull Rock hides the green: the right half is the fat side.',
    routes: [
      { id: 'safe', name: 'Turtle Bar', note: 'Right, down to the sandbar: no water to carry. Pitch on along the bar.' },
      { id: 'risky', name: 'The Lagoon', note: 'Straight at the flag, all carry. Skull Rock is six metres left of the line.' },
      { id: 'rocket', name: 'Over Skull Rock', note: 'A Rocket lob clears the 60 metre rock: the hidden left of the green is all yours.' },
    ],
  },
  surfaces,
  trees,
  woods: [],
  props,
  gadgets,
  obLine: L.rect(-215, -70, 275, 315),
  height,
  sea: true,
  probes: [
    { at: [-6, 70], kind: 'water', what: 'the carry' },
    { at: [-120, 120], kind: 'water', what: 'open sea left of the island' },
    { at: [-14, 240], kind: 'water', what: 'long' },
    { at: [SKULL[0] + 11, SKULL[1]], kind: 'water', what: 'the face of Skull Rock (a penalty area, like any cliff)' },
    { at: [100, 110], kind: 'water', what: 'the channel east of the bar' },
    { at: [-14, 114], kind: 'bunker', what: 'the beach' },
    { at: [15, 147], kind: 'bunker', what: 'the pot bunker' },
    { at: [46, 82], kind: 'fairway', what: 'Turtle Bar' },
    { at: [24, 125], kind: 'fairway', what: 'the path from the bar to the green' },
    { at: [16, 26], kind: 'rough', what: 'the bank down to the bar' },
    { at: [-36, 138], kind: 'green', what: 'the hidden left lobe' },
    { at: [0, -9], kind: 'rough', what: 'the tee rock' },
    { at: [66, 14], kind: 'rough', what: 'the harbour' },
  ],
};
