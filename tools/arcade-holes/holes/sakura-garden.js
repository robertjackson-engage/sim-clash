'use strict';
// Sakura Garden: par 3, 136 yd. A wedge from a shrine terrace 16 m up the south hill, down
// into a walled garden in a bowl of rice-terraced hills. The green is small (30 x 26 m, the
// smallest on the tour); the koi pond wraps its front and right, the lotus pond its left, and
// straight behind it the Great Falls come down a 74 m cliff.
// Three ways to play it (docs/dev/arcade-v2-contract.md, "Routes"):
//   SAFE    left of the flag: the Moss Path is mown all the way in at the front left, and
//           the fat half of the green is behind it. Nothing to carry; a long putt.
//   RISKY   at the flag: 112 yd of carry over the koi pond to a pin cut at the back right,
//           water short and right of it. A putt for birdie, or a ball in the pond.
//   ROCKET  off the Great Falls: a boosted wedge flies the pond and the whole green, hits
//           the waterfall 40 m up and comes down it onto the mown collar, which feeds it onto
//           the back of the green, a long putt from the flag. No distance to judge: only the line, between the two pools at the
//           cliff's foot. (An ordinary club hit far too hard comes back off the cliff too.)
// Local metres, x east, y north; the tee is the origin and the hole plays due north.
// Heights are metres above the ponds.

const L = require('../lib');

const RAD = Math.PI / 180;
const TEE = [0, 0];
const PIN = [-1, 124];                         // 136 yd
const C = [-6, 120];                           // the green's centre: the flag is back right of it, under the falls
const TEE_H = 18, GARDEN_M = 1.4, FALLS_H = 76;
const ss = L.smoothstep;

const at = (deg, r) => [C[0] + r * Math.cos(deg * RAD), C[1] + r * Math.sin(deg * RAD)];
// compass heading (clockwise from north) of the direction a -> b, as props are turned
const heading = (a, b) => (Math.atan2(b[0] - a[0], b[1] - a[1]) / RAD + 360) % 360;
// A polygon's signed distance (positive inside), not worked out at all beyond `reach`
// metres of its bounding box: the height function runs for every node of the grid.
const near = (poly, reach) => {
  const b = L.bbox(poly);
  return (x, y) => (x < b.minX - reach || x > b.maxX + reach || y < b.minY - reach || y > b.maxY + reach ? -Infinity : L.signedDistance(x, y, poly));
};

// ---- surfaces
const tee = L.rect(-6, -5, 6, 5);
const green = L.blob(C[0], C[1], 15, 13, { wobble: 0.04, seed: 8 });        // 30 x 26 m
const greenApron = L.offsetPolygon(green, 4);
const greenR = L.radiusOf(green, C);
const bankR = L.radiusOf(L.offsetPolygon(green, 5), C);                     // the ponds start 5 m off the green

// A pond wrapped round the green from a0 to a1 (degrees, counter-clockwise from east):
// wEnd metres wide at its tips, wMid at its middle.
const pondWidth = (t, wEnd, wMid) => wEnd + (wMid - wEnd) * Math.sin(Math.PI * t) ** 0.7;
function crescent(a0, a1, wEnd, wMid) {
  const n = Math.ceil((a1 - a0) / 5);
  const inner = [], outer = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = L.lerp(a0, a1, t), r = bankR(a * RAD);
    inner.push(at(a, r));
    outer.push(at(a, r + pondWidth(t, wEnd, wMid)));
  }
  return L.ensureCCW(L.smoothPolygon([...outer, ...inner.reverse()], 1));
}
const KOI = { a0: -92, a1: 38, wEnd: 8, wMid: 23 };        // in front of the flag, right of the green, and round to the foot of the falls
const LOTUS = { a0: 134, a1: 198, wEnd: 7, wMid: 19 };     // left of the green
const koiPond = crescent(KOI.a0, KOI.a1, KOI.wEnd, KOI.wMid);
const lotusPond = crescent(LOTUS.a0, LOTUS.a1, LOTUS.wEnd, LOTUS.wMid);
const teaPond = L.blob(44, 56, 15, 10, { wobble: 0.08, seed: 17, rotDeg: 20 });   // scenery, right of the tee shot
const pondsNoPlunge = [koiPond, lotusPond, teaPond];
// the middle of a wrapped pond at angle a, and its width there
const across = (pond, a) => {
  const t = (a - pond.a0) / (pond.a1 - pond.a0), w = pondWidth(t, pond.wEnd, pond.wMid), r = bankR(a * RAD);
  return { mid: at(a, r + w / 2), near: at(a, r), far: at(a, r + w), w };
};

// the dry way in: the Moss Path, mown from the foot of the tee's hill to the front left of the green
const path = L.capsule([[-10, 60], [-16, 80], [-19, 98]], [22, 26, 20]);
// the collar: mown ground between the back of the green and the foot of the waterfall cliff, tilted
// to the green, so a ball that comes down the cliff trickles on toward the flag
const collarArc = [];
for (let a = 54; a <= 124; a += 5) collarArc.push(at(a, greenR(a * RAD) + 4.6));
const collar = L.capsule(collarArc, 7.4, { stepM: 3 });
// the pagoda's terrace, on top of the falls (scenery: nothing comes to rest up there but a ball hit far too hard)
const lawn = L.blob(-2, 168, 30, 14, { wobble: 0.04, seed: 23 });

// stepping-stone bunkers: three pots well short of the koi pond (clear of where a ball in it is dropped), three more marching
// up the left of the path to the lotus pond (none under the cliff: the ground there is too steep for sand)
const stones = [
  L.blob(4, 58, 2.6, 2.6, { wobble: 0.06, seed: 40 }),
  L.blob(9, 64, 2.6, 2.6, { wobble: 0.06, seed: 41 }),
  L.blob(13, 71, 2.4, 2.4, { wobble: 0.06, seed: 42 }),
  L.blob(-38.5, 86, 2.6, 2.6, { wobble: 0.06, seed: 51 }),
  L.blob(-40.5, 93, 2.6, 2.6, { wobble: 0.06, seed: 52 }),
  L.blob(-41.5, 100, 2.6, 2.6, { wobble: 0.06, seed: 53 }),
];
const ponds = pondsNoPlunge;
const teaPad = L.blob(-92, 92, 20, 16, { wobble: 0.05, seed: 61 });           // the tea house's terrace, west
const eastPad = L.blob(86, 108, 18, 16, { wobble: 0.05, seed: 62 });          // the screen and the stands, east

// ---- ground: a level garden in a bowl of terraced hills; the waterfall cliff closes its north end
const sdCollar = near(L.offsetPolygon(collar, 1), 6);
const sdGreen = near(greenApron, 12), sdLawn = near(L.offsetPolygon(lawn, 3), 8);
const sdPonds = ponds.map((p) => near(p, 4)), sdStones = stones.map((b) => near(b, 4));
const sdTea = near(teaPad, 14), sdEast = near(eastPad, 14);
const roll = L.fbm({ seed: 611, scaleM: 50, octaves: 3 });
const hillNoise = L.fbm({ seed: 612, scaleM: 90, octaves: 3 });
const rockNoise = L.fbm({ seed: 613, scaleM: 28, octaves: 2 });
const greenPlane = L.plane(2.3, C, 0.005, 0.010);                           // 1.1 %, rising to the back right
// rice terraces: ground cut into level steps
const ledges = (h, step, k) => { const t = h / step, f = t - Math.floor(t); return L.lerp(h, step * (Math.floor(t) + ss(0.35, 0.65, f)), k); };

function height(x, y) {
  const r = Math.hypot(x, (y - 75) * 0.85) + 8 * hillNoise(x * 1.4, y * 1.4);
  let h = GARDEN_M + 0.35 * roll(x, y);
  // the hills: terraces up to the ridge
  const hill = ss(98, 116, r);
  if (hill) h = L.lerp(h, ledges(3 + 46 * ss(100, 210, r) + 5 * hillNoise(x, y), 4.5, 0.75), hill);
  const tea = ss(-10, 0, sdTea(x, y));
  if (tea) h = L.lerp(h, 6, tea);
  const east = ss(-10, 0, sdEast(x, y));
  if (east) h = L.lerp(h, 3.5, east);
  // the waterfall cliff behind the green, the Pagoda Lawn on top of it, the mountain behind that
  const lane = 1 - ss(62, 104, Math.abs(x));
  const onGreen = ss(-8, 0, sdGreen(x, y));
  if (onGreen) h = L.lerp(h, greenPlane(x, y), onGreen);
  const onCollar = ss(-3, 0, sdCollar(x, y));
  if (onCollar) {
    const ang = Math.atan2(y - C[1], x - C[0]);
    h = L.lerp(h, greenPlane(x, y) + 0.17 * Math.max(0, Math.hypot(x - C[0], y - C[1]) - greenR(ang) - 2.5), onCollar);
  }
  const cliff = lane * ss(142.6, 147.6, y);
  if (cliff) h = L.lerp(h, FALLS_H + 0.6 * rockNoise(x, y) * (1 - ss(-6, 0, sdLawn(x, y))) + 14 * ss(186, 226, y), cliff);
  // the tee's terrace on the south hill: its lip is the front of the tee, so the whole garden is in view
  const bluff = ss(32, 6, y + 0.004 * x * x) * (1 - ss(90, 140, Math.abs(x)));
  if (bluff) h = L.lerp(h, ledges(TEE_H + 10 * ss(-30, -90, y) + 1.5 * rockNoise(x, y) * ss(10, 26, Math.hypot(x, y)), 4.5, 0.5 * ss(12, 36, Math.hypot(x, y))), bluff);
  for (const sd of sdStones) {
    const sand = sd(x, y);
    if (sand > 0) h -= 0.3 * ss(0, 2, sand);
  }
  // the ponds: the bank drops to the water inside the outline, never outside it
  for (const sd of sdPonds) {
    const wet = sd(x, y);
    if (wet > 0) h = L.lerp(h, 0, ss(0, 2.5, wet));
  }
  return h;
}

// ---- cherry trees. `trees` are real obstacles (the look stream draws them in blossom):
// they stand on the hills and in groves well wide of the hole. The trees near the line of
// play are `sakura-tree` props, which a ball flies through.
const keepClear = [...ponds, green, path, collar, lawn, ...stones, teaPad, eastPad];
const groves = L.fbm({ seed: 614, scaleM: 44, octaves: 2 });
const trees = [
  ...L.scatterTrees(L.rect(-168, -82, 168, 268), {
    spacing: 14, seed: 61, avoid: keepClear, clearM: 8,
    keep: (x, y) => {
      if (Math.abs(x) < 30 && y > -20 && y < 140) return false;               // the tee shot
      if (Math.abs(x) < 64 && y > 130 && y < 190) return false;               // the cliff and the lawn
      if (Math.hypot(x, (y - 75) * 0.85) < 104 || Math.hypot(x, y) < 26) return false;
      const steep = Math.hypot(height(x + 2, y) - height(x - 2, y), height(x, y + 2) - height(x, y - 2)) / 4;
      return steep < 0.8 && groves(x, y) > -0.3;
    },
  }),
  ...L.clusterTrees(-74, 52, { count: 6, radius: 13, seed: 62 }),
  ...L.clusterTrees(84, 64, { count: 6, radius: 13, seed: 63 }),
  ...L.clusterTrees(-66, 132, { count: 5, radius: 11, seed: 64 }),
];

const P = (kind, x, y, heightM, rotDeg = 0) => L.prop(kind, x, y, { heightM, rotDeg });
const face = (kind, x, y, heightM, tx, ty) => P(kind, x, y, heightM, L.facing(x, y, tx, ty));
const sakura = (x, y, heightM, rotDeg = 0) => P('sakura-tree', x, y, heightM, rotDeg);
const lantern = (x, y, heightM = 2) => P('stone-lantern', x, y, heightM);
const bridgeOver = (pond, a) => { const s = across(pond, a); return P('bridge', s.mid[0], s.mid[1], s.w + 5, heading(s.near, s.far)); };
const onBank = (pond, a, off) => { const s = across(pond, a); return at(a, Math.hypot(s.far[0] - C[0], s.far[1] - C[1]) + off); };
const onPlay = (x, y, m = 2.5) => [green, path, collar, tee, ...stones].some((p) => L.signedDistance(x, y, p) > -m);
const offLine = (x, y, m = 9) => L.distToSegment(x, y, TEE[0], TEE[1], PIN[0], PIN[1]) > m;

const props = [
  // --- the shrine terrace: a torii avenue down the steps to the Moss Path, lanterns, banners
  P('torii', -14, 12, 7, 350), P('torii', -17, 22, 7, 352), P('torii', -19, 32, 7, 355), P('torii', -19, 42, 7, 0),
  lantern(-8.5, 9), lantern(8.5, 9), lantern(-22, 17, 2.2), lantern(-24, 37, 2.2),
  face('pagoda', -36, -34, 16, 0, 0), P('flag-banner', -14, -9, 7, 20), P('flag-banner', 14, -9, 7, -20),
  face('crowd', 24, -8, 2.6, 0, 0), face('crowd', -30, -10, 2.6, 0, 0),
  sakura(-15, -12, 8, 45), sakura(15, -12, 7.5, 225), sakura(-30, -24, 9, 10), sakura(31, -22, 8.5, 190), sakura(0, -30, 9, 90), sakura(22, 8, 7, 330),

  // --- the waterfall, the Pagoda Lawn and the great pagoda on top of it
  face('waterfall', 32, 138.5, 48, 32, 60), face('waterfall', -50, 138.5, 46, -50, 60),
  P('pagoda', 46, 166, 30, 185), face('torii', -2, 181, 11, -2, 100), face('statue', -44, 170, 7, -2, 161),
  lantern(-34, 148, 2.6), lantern(30, 148, 2.6), lantern(-36, 174, 2.6), lantern(32, 178, 2.6), lantern(-16, 179, 2.6), lantern(12, 179, 2.6),
  sakura(-48, 156, 9, 30), sakura(-40, 184, 8, 200), sakura(34, 188, 9, 110), sakura(58, 150, 8, 60), sakura(20, 192, 8.5, 20), sakura(-22, 192, 9, 250),
  P('fireworks', -40, 200, 26), P('fireworks', 50, 200, 26), face('crowd', -52, 162, 2.6, -2, 161),

  // --- the koi pond: a torii standing in it, bridges, the koi statue, a boat, blossom round its banks
  P('torii', ...across(KOI, -24).mid, 9, 205),
  bridgeOver(KOI, 10), bridgeOver(LOTUS, 166), P('bridge', 44, 56, 26, 20),
  face('statue', 46, 100, 8, C[0], C[1]), P('boat', ...across(KOI, -52).mid, 4, 40), P('fountain', 62, 82, 4),
  ...[-74, -54, -34, -12, 6, 22, 36].map((a, i) => sakura(...onBank(KOI, a, 4.5 + (i % 2) * 2.5), 6.5 + (i * 1.3) % 3, a + 90)),
  // ... round the lotus pond ...
  ...[136, 150, 166, 184, 197].map((a, i) => sakura(...onBank(LOTUS, a, 4.5 + (i % 2) * 2), 6 + (i * 1.7) % 3, a + 90)),
  // ... along the Moss Path, by the tea pond and out across the lawns
  sakura(-33, 54, 7.5, 80), sakura(-36, 74, 8.5, 300), sakura(-50, 108, 7, 170), sakura(62, 44, 7.5, 20), sakura(24, 66, 6.5, 140), sakura(64, 66, 8, 250),
  sakura(-52, 30, 8, 200), sakura(-64, 86, 7, 20), sakura(-68, 128, 8.5, 260), sakura(-58, 136, 7, 150),
  sakura(52, 118, 8, 70), sakura(66, 132, 7.5, 310), sakura(62, 138, 8.5, 130), sakura(44, 22, 7, 240), sakura(-44, 6, 7.5, 60), sakura(74, 40, 9, 180),
  // stone lanterns: down the path, at the pond tips and round the green
  lantern(-25, 50, 2.2), lantern(-29, 66, 2.2), lantern(-34, 82), lantern(-6, 66, 2.2), lantern(20, 92),
  lantern(...at(210, bankR(210 * RAD) + 1.5), 1.8), lantern(...at(-152, greenR(-152 * RAD) + 2.5), 1.8),
  lantern(...at(130, greenR(130 * RAD) + 3), 1.8),

  // --- the tea house on its terrace, west; the screen and the stands, east
  face('pagoda', -94, 94, 13, -40, 100), face('hut', -84, 78, 4.5, -40, 90), lantern(-78, 96, 2.2), lantern(-82, 106, 2.2),
  face('gate', -52, 56, 8, -10, 60),
  face('jumbotron', 90, 112, 11, C[0], C[1]), face('grandstand', 82, 98, 7, C[0], C[1]),
  face('crowd', 58, 108, 2.6, C[0], C[1]), face('crowd', -56, 118, 2.6, C[0], C[1]), face('crowd', 50, 132, 2.6, C[0], C[1]),
  P('flag-banner', 72, 122, 7, 250), P('flag-banner', 70, 92, 7, 290),

  // --- the terraced hills: tea huts, small pagodas, torii on the ridges, more falls
  face('hut', -128, 60, 5, 0, 80), face('hut', 126, 44, 5, 0, 80), face('hut', -132, 132, 5, 0, 100), face('hut', 130, 140, 5, 0, 100),
  face('pagoda', -140, 190, 18, 0, 100), face('pagoda', 142, 196, 18, 0, 100), face('torii', -118, 10, 9, 0, 60), face('torii', 120, 4, 9, 0, 60),
  face('waterfall', -112, 186, 26, -40, 120), face('waterfall', 114, 190, 26, 40, 120),
  P('windmill', 150, 90, 14, 250),
  // --- overhead
  P('bird-flock', -40, 80, 8), P('bird-flock', 60, 150, 8), P('cloud', -120, 250, 24), P('cloud', 130, 260, 24), P('balloon', -110, 150, 20), P('balloon', 130, 60, 20),
].filter((p) => L.FLOATING_PROP_KINDS.includes(p.kind) || p.kind === 'bridge' || (!onPlay(p.x, p.y) && offLine(p.x, p.y, L.SLIM_PROP_KINDS.includes(p.kind) ? 6 : 9)));

// ---- gadgets (docs/gadgets.md): what a swing can hit
//   RISKY   the Festival Lantern hangs over the koi pond on the line at the flag: a wedge
//           that goes through it bursts it for coins and flies on untouched. Round the flag
//           the green is a Tea Bowl, a funnel that draws a ball that lands near it in to
//           tap-in range; the Koi Rail on the pond's bank kicks back a ball that is running
//           off the green's right side.
//   SAFE    the Moss Runner, a slow speed strip at the end of the Moss Path, walks a ball
//           that was laid up there on to the front left of the green.
//   ROCKET  coins up to the Great Falls, along the Rocket wedge's flight.
const flagWedge = L.flight(height, TEE, PIN, { speedMph: 91, vla: 25.5, spin: 9300 });
const fallsRocket = L.flight(height, TEE, [-1, 150], { speedMph: 91, vla: 25.5, spin: 9300, ball: 'rocket' });
const lanternAt = flagWedge.at(60);
const koiRail = [];
for (let a = -42; a <= 28; a += 10) koiRail.push(at(a, greenR(a * RAD) + 2.6).map(L.round2));
const gadgets = [
  L.gadget('breakable', 'festival-lantern', lanternAt.x, lanternAt.y, { z: L.round2(lanternAt.z - 3), radius: 3, height: 6, breakMph: 50, keep: 1, style: 'pinata' }),
  L.gadget('funnel', 'tea-bowl', -2.5, 122, { radius: 7, strength: 1 }),
  { id: 'koi-rail', kind: 'rail', points: koiRail, strength: 4 },
  L.gadget('strip', 'moss-runner', -18, 93, { size: [12, 18], heading: L.bearing([-19, 92], [-9, 114]), strength: 4, maxMps: 4 }),
  fallsRocket.coins('falls-coins', 30, 130, 6),
];

module.exports = {
  id: 'sakura-garden',
  extent: { minX: -200, minY: -110, maxX: 200, maxY: 300 },
  hole: {
    par: 3,
    name: 'Sakura Garden',
    line: [TEE, PIN],
    note: 'A small green wrapped in ponds under the Great Falls. At the flag it is 112 yards of carry over the koi pond; left of the flag is the dry way in. A Rocket wedge goes in off the waterfall.',
    greenNote: 'The smallest green on the tour. Water short and right of the flag; the lotus pond on the left; the cliff behind throws a long one back onto the collar.',
    routes: [
      { id: 'safe', name: 'The Moss Path', note: 'Left of the flag: mown all the way in, and the fat half of the green behind it. No water to carry.' },
      { id: 'risky', name: 'Over the Koi Pond', note: 'At the flag: 112 yards of carry, water short and right, the cliff behind. A putt for birdie if it comes off.' },
      { id: 'rocket', name: 'Off the Great Falls', note: 'A Rocket wedge hits the waterfall high above the green and comes down it to the flag. Only the line matters.' },
    ],
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    { kind: 'fairway', poly: path },
    { kind: 'fairway', poly: collar },
    { kind: 'green', poly: green },
    ...stones.map((poly) => ({ kind: 'bunker', poly })),
    ...ponds.map((poly) => ({ kind: 'water', poly })),
  ],
  trees,
  // moss, darker than the lawns: the garden's walks and the rock of the waterfall cliff
  woods: [
    L.capsule([[-52, 56], [-70, 80], [-80, 92]], 5),
    L.capsule([[30, 70], [52, 92], [70, 104]], 5),
    L.capsule([[-56, 139.5], [0, 140], [56, 139.5]], 6),
  ],
  props,
  gadgets,
  obLine: L.rect(-176, -90, 176, 276),
  height,
  sea: false,
  probes: [
    { at: [0, 97], kind: 'water', what: 'the koi pond, on the line to the flag' },
    { at: [22, 120], kind: 'water', what: 'the koi pond right of the green' },
    { at: across(KOI, 28).mid.map(L.round2), kind: 'water', what: 'the koi pond at the foot of the great fall, right of the flag' },
    { at: across(LOTUS, 170).mid.map(L.round2), kind: 'water', what: 'the lotus pond left of the green' },
    { at: [44, 56], kind: 'water', what: 'the tea pond' },
    { at: [0, 82], kind: 'rough', what: 'short of the koi pond on the line' },
    { at: [0, 105.8], kind: 'rough', what: 'the bank between the koi pond and the green' },
    { at: [-18, 95], kind: 'fairway', what: 'the dry way in' },
    { at: at(92, greenR(92 * RAD) + 5).map(L.round2), kind: 'fairway', what: 'the collar under the waterfall cliff' },
    { at: [-2, 168], kind: 'rough', what: 'the pagoda terrace on top of the falls' },
    { at: [-12, 116], kind: 'green', what: 'the safe half of the green' },
    { at: [9, 64], kind: 'bunker', what: 'a stepping stone short of the koi pond' },
    { at: [-40.5, 93], kind: 'bunker', what: 'a stepping stone left of the path' },
    { at: [-50, 146], kind: 'rough', what: 'the waterfall cliff' },
    { at: [-70, 20], kind: 'rough', what: 'a wide miss left' },
    { at: [190, 100], kind: 'ob', what: 'over the eastern hills' },
  ],
  stage: {
    number: 6, role: 'match', order: 6,
    name: 'Sakura Garden', theme: 'sakura',
    origin: { lat: 34.6, lon: 152.0 },         // open Pacific, east of Japan
    conditions: 'calm',
    wind: { min: 0, max: 7 },                  // a walled garden: a breath of air at most
    timeOfDay: 'day',
    blurb: 'A wedge through the blossom to a green wrapped in koi ponds, under the Great Falls.',
    difficulty: 2,
  },
};
