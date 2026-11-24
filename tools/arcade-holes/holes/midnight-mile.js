'use strict';
// Midnight Mile: par 5, about 550 yd, the finale. A night city on three levels: the tee is
// the roof of a tower 28 m above the street, the harbour basin fills the inside of the
// dogleg, and the green is sunk in a stadium beyond it, behind a moat.
// Three ways home (hole.routes):
//   SAFE   the Boulevard. Right of the water all the way: a drive up the street, a second
//          along the Skyway (the raised terrace), a wedge down into the stadium from the
//          east. No carry anywhere. Three shots.
//   RISKY  the Docks. Straight at the flag: 215 yd of carry over the basin to the lower
//          fairway on the quay, water short, left and right. From there a mid iron over the
//          moat is on the green in two.
//   ROCKET the Helipad. Eleven degrees left of the flag, 370 to 430 yd out: the roof of a
//          tower block standing in the harbour, 26 m up and tilted to face the tee. Only a
//          boosted ball gets there. It leaves a wedge straight down at the flag. (A bigger
//          Rocket at the flag itself carries the moat and is putting.)
// Local metres, x east, y north; the tee is the origin. Heights are metres above the
// quay of the Docks (the water is 3 m below that, the street 6 m above it).

const L = require('../lib');

const RAD = Math.PI / 180;
const TEE = [0, 0];
const PIN = [-110, 430];                                 // 485 yd straight
const LINE = [TEE, [32, 222], [-10, 383], PIN];           // up the Boulevard, along the Skyway, left into the stadium
const G = [-110, 432];                                   // the middle of the green and of the stadium

const WATER_H = -3;
const STREET_H = 6, SKYWAY_H = 10;                       // the Boulevard's two levels
const TEE_H = 34;                                        // the roof the tee is on
const PAD_H = 26, PAD_RISE = 0.13;                       // the helipad's roof: this high at its near edge, climbing 13 % away from the tee
const GREEN_H = 1.6;

// ---- the water: the canal up the west side of the tee, the basin, its arm between the
// Docks and the Boulevard, the west arm under the helipad tower, and the moat in front of
// the green. One polygon (round the Docks, which is a peninsula).
const water = L.ensureCCW([
  [-58, -92], [-24, -92], [-24, 118],                                    // the canal
  [-12, 150], [-4, 190], [-6, 240], [-12, 290], [-24, 326], [-40, 336],  // the arm under the Skyway's wall
  [-52, 318], [-49, 300], [-37, 250], [-25, 205], [-24, 196],            // back down the Docks' east quay
  [-88, 180], [-91, 194], [-104, 250], [-117, 300], [-120, 316], [-120, 351],  // round its south end and up its west quay
  [-84, 356], [-80, 372], [-84, 390],                                    // the moat's east end
  [-96, 397], [-112, 399], [-128, 398], [-150, 394], [-176, 386], [-200, 380], [-208, 372],   // its north shore, in front of the green
  [-208, 366], [-136, 366], [-136, 292], [-208, 292],                    // round the foot of the helipad tower
  [-208, 140], [-200, 124], [-58, 118],                                  // the west quay, the basin's south shore
]);

// ---- surfaces
const tee = L.rect(-7, -5, 7, 5);
const teeRoof = L.rect(-20, -30, 20, 7);                 // the tee's tower block: the tee is at its front edge, so the city is in view
const padRoof = L.rect(-208, 292, -136, 366);            // the helipad's tower block: its foot is in the harbour
const helipad = L.rect(-200, 300, -144, 358);            // the fairway on its roof, inside the parapet
const boulevard = L.capsule(
  [[6, 50], [24, 130], [34, 222], [26, 300], [-9, 386]],
  [44, 56, 60, 58, 54],
);
const stadiumLeg = L.capsule([[-9, 386], [-48, 410], [-86, 426]], [52, 44, 36]);
const docks = [                                          // the lower fairway and the forecourt beyond it
  [-32, 203], [-44, 250], [-56, 300], [-59, 318], [-60, 344], [-113, 344], [-113, 318], [-110, 300], [-97, 250], [-84, 201], [-82, 190],
];
const green = L.blob(G[0], G[1], 20, 18, { wobble: 0.05, seed: 4 });         // 40 x 36 m
const greenApron = L.offsetPolygon(green, 4);
const bunkers = [
  L.blob(76, 232, 8, 15, { wobble: 0.1, seed: 12 }),                         // right of the drive
  L.blob(60, 318, 7, 12, { wobble: 0.1, seed: 13, rotDeg: -25 }),            // right of the second
  L.blob(-80, 447, 6, 9, { wobble: 0.08, seed: 14, rotDeg: 35 }),            // back right of the green
  L.blob(-136, 448, 6.5, 8.5, { wobble: 0.08, seed: 15, rotDeg: -30 }),      // back left of it
  L.blob(-36, 432, 6, 8, { wobble: 0.08, seed: 16, rotDeg: 60 }),            // long of the Skyway's end
];

// ---- ground
const street = L.fbm({ seed: 901, scaleM: 90, octaves: 2 });
const blocks = L.fbm({ seed: 902, scaleM: 60, octaves: 2 });
const greenPlane = L.plane(GREEN_H, G, 0.006, -0.009);                       // 1.1 %, falling to the moat
const docksPlane = L.plane(2.0, [-50, 195], 0, -0.0105);                     // the quay runs gently downhill, away from the tee
// the Boulevard's centre line by northing, for laying the city out beside it
const routeX = (y) => {
  const pts = [[6, -400], [6, 50], [24, 130], [36, 225], [26, 300], [-8, 388], [-8, 900]];
  for (let i = 1; i < pts.length; i++) {
    if (y <= pts[i][1]) return L.lerp(pts[i - 1][0], pts[i][0], (y - pts[i - 1][1]) / (pts[i][1] - pts[i - 1][1]));
  }
  return -8;
};
// the stadium: terraces round the north of the green, from east-north-east round to the west
const STAND = { fromR: 36, n: 4, depthM: 8, riseM: 3.5, riserM: 2.2, wallM: 2.2, midDeg: 112, halfDeg: 92, rimM: 16 };
const standAt = (deg) => L.smoothstep(STAND.halfDeg + 12, STAND.halfDeg - 4, Math.abs(((deg - STAND.midDeg + 540) % 360) - 180));
const standR = (k) => STAND.fromR + k * STAND.depthM + STAND.riserM + (STAND.depthM - STAND.riserM) / 2;
const RIM_R = STAND.fromR + STAND.n * STAND.depthM;

function height(x, y) {
  // street level; the Boulevard climbs onto the Skyway where the basin opens beside it
  let h = STREET_H + (SKYWAY_H - STREET_H) * L.smoothstep(150, 196, y) + 0.3 * street(x, y);
  // the city blocks east of the Boulevard stand on terraces above it, the far quay likewise
  const east = x - routeX(y);
  h += (5 + 0.8 * blocks(x, y)) * L.smoothstep(40, 46, east) + (6 + blocks(x, y)) * L.smoothstep(84, 90, east);
  h += (3 + 0.6 * blocks(x, y)) * L.smoothstep(-214, -220, x) + (6 + blocks(x, y)) * L.smoothstep(-250, -256, x);
  // the arena: the ground falls to the green from every side
  const dx = x - G[0], dy = y - G[1], r = Math.hypot(dx, dy);
  const dip = 1 - L.smoothstep(34, 128, r);
  if (dip) h = L.lerp(h, GREEN_H, dip);
  // the Docks and the forecourt: the low quay
  const low = L.plateauWeight(x, y, docks, 16);
  if (low) h = L.lerp(h, docksPlane(x, y), low);
  // the stands: terraces stepping up behind the green
  const stand = standAt(Math.atan2(dy, dx) / RAD);
  if (stand && r > STAND.fromR) {
    const d = r - STAND.fromR;
    let up = STAND.wallM * L.smoothstep(0, STAND.riserM, d);
    for (let k = 1; k <= STAND.n; k++) up += STAND.riseM * L.smoothstep(k * STAND.depthM, k * STAND.depthM + STAND.riserM, d);
    const top = GREEN_H + up;
    const behind = L.smoothstep(STAND.n * STAND.depthM + STAND.rimM, STAND.n * STAND.depthM + STAND.rimM + 22, d);
    h = L.lerp(h, L.lerp(top, 11 + blocks(x, y), behind), stand);
  }
  const onGreen = L.plateauWeight(x, y, greenApron, 8);
  if (onGreen) h = L.lerp(h, greenPlane(x, y), onGreen);
  for (const b of bunkers) {
    const sand = L.signedDistance(x, y, b);
    if (sand > 0) h -= 0.5 * L.smoothstep(0, 3, sand);
  }
  // the water: quay walls straight down to it
  const cut = L.plateauWeight(x, y, water, 4);
  if (cut) h = L.lerp(h, WATER_H, cut);
  // the two tower blocks: sheer walls, flat roofs (the helipad's has a low parapet to hold a hot ball)
  const pad = L.plateauWeight(x, y, padRoof, -2);
  if (pad) h = L.lerp(h, PAD_H + PAD_RISE * (y - 292) + 2.4 * (1 - L.smoothstep(4, 7.5, L.signedDistance(x, y, padRoof))), pad);
  const roof = L.plateauWeight(x, y, teeRoof, -3);
  if (roof) h = L.lerp(h, TEE_H, roof);
  return h;
}

// street trees: down the east side of the Boulevard, on the fan zone, on the far quay
const trees = [];
for (let y = 60; y <= 380; y += 32) if (!bunkers.some((b) => L.signedDistance(routeX(y) + 37, y, b) > -5)) trees.push([routeX(y) + 36 + (y % 64 ? 2 : 0), y]);
for (let y = 150; y <= 310; y += 40) trees.push([-218, y]);
trees.push(...L.clusterTrees(-84, -52, { count: 4, radius: 9, seed: 91 }), ...L.clusterTrees(40, -50, { count: 4, radius: 9, seed: 92 }),
  ...L.clusterTrees(-236, 60, { count: 4, radius: 9, seed: 93 }));

// ---- props
const P = (kind, x, y, heightM, rotDeg = 0) => L.prop(kind, x, y, { heightM, rotDeg });
const ringAt = (r, deg) => [G[0] + r * Math.cos(deg * RAD), G[1] + r * Math.sin(deg * RAD)];
const toGreen = (x, y) => L.facing(x, y, G[0], G[1]);
const toTee = (x, y) => L.facing(x, y, 0, 0);
const rnd = L.mulberry32(909);
const props = [];

// the skyline canyon: three rows of towers stepping up east of the Boulevard ...
for (const [off, step, lo, hi, y0] of [[56, 44, 38, 72, 30], [104, 52, 80, 140, 10], [158, 64, 130, 230, 40]]) {
  for (let y = y0; y <= 470; y += step) props.push(P('skyscraper', routeX(y) + off + 8 * (rnd() - 0.5), y + 10 * (rnd() - 0.5), Math.round(lo + (hi - lo) * rnd()), Math.round(rnd() * 3) * 30));
}
// ... two rows on the far quay, west of the harbour ...
for (const [x0, step, lo, hi, y0] of [[-236, 46, 44, 90, 110], [-282, 58, 100, 190, 90]]) {
  for (let y = y0; y <= 540; y += step) {
    if (x0 === -236 && y > 270 && y < 390) continue;                         // the helipad tower's back is kept clear
    props.push(P('skyscraper', x0 + 8 * (rnd() - 0.5), y + 10 * (rnd() - 0.5), Math.round(lo + (hi - lo) * rnd()), Math.round(rnd() * 3) * 30));
  }
}
// ... the old town across the canal, the blocks behind the tee, and the giants past the stadium
[[-92, -70, 64], [-128, -20, 96], [-96, 30, 52], [-150, 60, 120], [-110, 84, 44], [-190, 10, 150], [-178, 92, 70], [-230, -60, 180],
  [58, -74, 110], [112, -40, 76], [-40, -130, 140], [30, -150, 170], [150, -110, 130],
  [-250, 600, 170], [-180, 640, 230], [-104, 668, 280], [-30, 640, 210], [44, 600, 160], [110, 560, 190], [-320, 520, 150], [170, 500, 140]]
  .forEach(([x, y, h], i) => props.push(P('skyscraper', x, y, h, (i * 37) % 90)));
// the helipad tower's neighbours, so it reads as one block of a skyline
props.push(P('skyscraper', -246, 310, 96, 0), P('skyscraper', -242, 362, 64, 30));

// neon down the Boulevard and billboards on the terraces above it, all facing the players
for (const [y, h] of [[70, 9], [118, 11], [168, 10], [214, 12], [262, 10], [306, 11], [350, 10], [396, 12]]) {
  const x = routeX(y) + 38;
  props.push(P('neon-sign', x, y, h, L.facing(x, y, routeX(y - 30), y - 30)));
}
for (const [y, h] of [[96, 15], [190, 17], [284, 16], [372, 18]]) {
  const x = routeX(y) + 74;
  props.push(P('billboard', x, y, h, L.facing(x, y, routeX(y - 60), y - 60)));
}
// street lights down both kerbs
for (const y of [60, 150, 240, 330]) {
  props.push(P('floodlight', routeX(y) + 34, y + 20, 26, L.facing(routeX(y) + 34, y + 20, routeX(y), y + 20)));
}
// the tee's roof: flags and fire at its corners, the hole's name in neon behind the players
props.push(
  P('flag-banner', -17, 4, 8, 20), P('flag-banner', 17, 4, 8, 340), P('flag-banner', -17, -12, 8, 60), P('flag-banner', 17, -12, 8, 300),
  P('torch', -11, 4, 3.5), P('torch', 11, 4, 3.5), P('torch', -10, -16, 3.5), P('torch', 10, -16, 3.5),
  P('neon-sign', 0, -25, 11, L.facing(0, -25, 0, 60)),
  P('crowd', -13, -22, 2.4, L.facing(-13, -22, -13, 40)), P('crowd', 13, -22, 2.4, L.facing(13, -22, 13, 40)),
);
// the canal: three bridges (heightM is the span) and the boats under them
for (const y of [-40, 28, 92]) props.push(P('bridge', -41, y, 40, 90));
props.push(P('boat', -41, -8, 6, 0), P('boat', -44, 60, 5, 180), P('boat', -36, 108, 5.5, 20));
// the harbour: yachts at anchor, fountains playing, a light on the corner of the west quay
props.push(
  ...[[-110, 150, 12, 70], [-150, 168, 9, 110], [-178, 150, 7, 40], [-190, 210, 10, 0], [-160, 250, 8, 160], [-130, 232, 6, 200],
    [-186, 272, 11, 30], [-150, 274, 7, 250], [-127, 336, 6, 0], [-14, 262, 6, 10], [-22, 306, 5.5, 200], [-170, 378, 6, 100]].map(([x, y, h, rot]) => P('boat', x, y, h, rot)),
  ...[[-144, 196, 14], [-174, 236, 11], [-104, 150, 10], [-134, 376, 9], [-114, 382, 9]].map(([x, y, h]) => P('fountain', x, y, h)),
  P('lighthouse', -216, 122, 26, 0),
  P('neon-sign', -214, 200, 12, L.facing(-214, 200, -60, 240)), P('neon-sign', -214, 280, 12, L.facing(-214, 280, -70, 280)),
  P('billboard', -222, 240, 18, L.facing(-222, 240, 0, 0)), P('billboard', -150, 100, 16, L.facing(-150, 100, 0, 0)), P('billboard', -80, 100, 13, L.facing(-80, 100, 0, 0)),
);
// the Docks: quay lights along both edges of the lower fairway
for (const [x, y] of [[-29, 206], [-40.5, 252], [-52.5, 302], [-88, 200], [-100.5, 252], [-113.5, 302]]) props.push(P('torch', x, y, 4));
// the helipad: lights at the corners of the roof, flags, its name in neon on the back parapet
props.push(
  ...[[-205, 295], [-139, 295], [-205, 363], [-139, 363]].map(([x, y]) => P('floodlight', x, y, 12, L.facing(x, y, -172, 329))),
  P('flag-banner', -172, 295, 7, 0), P('flag-banner', -205, 329, 7, 90), P('flag-banner', -139, 329, 7, 270),
  P('neon-sign', -172, 363.5, 10, L.facing(-172, 363.5, 0, 0)),
);
// the fan zone between the Skyway and the forecourt: a screen, a fountain, statues, the overflow crowd
props.push(
  P('jumbotron', -34, 352, 13, L.facing(-34, 352, -80, 300)),
  P('fountain', -52, 360, 8), P('statue', -40, 366, 8, toGreen(-40, 366)), P('statue', -64, 352, 8, toGreen(-64, 352)),
  P('crowd', -62, 377, 3, toGreen(-62, 377)), P('crowd', -70, 364, 3, toGreen(-70, 364)),
  P('flag-banner', -58, 348, 7, 0), P('flag-banner', -44, 347, 7, 0), P('flag-banner', -34, 362, 7, 0), P('flag-banner', -75, 354, 7, 0),
  P('neon-sign', -46, 373, 9, L.facing(-46, 373, -80, 320)),
);
// the stadium (v3:stadium): seven sections of the stadium kit on the foot of the terrace wall, an arc
// from the east-north-east round the back of the green to the west. They stand ON the terraces
// (which are still the ground a ball lands on), share their side lines and close without a gap
// (L.standRing); the two ends are corners with a floodlight pylon. Screens and masts behind the roof.
const inStand = (deg) => standAt(deg) >= 1;
const ARC = [STAND.midDeg - STAND.halfDeg + 4, STAND.midDeg + STAND.halfDeg - 4];
const BOWL_Z = GREEN_H - 0.15;
const MILE = ['', 'M', 'I', 'L', 'E', '', ''];              // west to east, as read from the green
props.push(...L.standRing((deg) => ringAt(STAND.fromR, deg), {
  from: ARC[0], to: ARC[1], n: 7, z: BOWL_Z, corners: [0, 6], text: (i) => MILE[6 - i] || null, team: ['#ff3df2', '#3df2ff'], id: 'bowl',
}));
const SCREENS = [60, 112, 164];
for (const deg of SCREENS) { const [x, y] = ringAt(RIM_R + 20, deg); props.push(P('jumbotron', x, y, deg === 112 ? 52 : 44, toGreen(x, y))); }
for (const deg of [26, 58, 90, 134, 166, 198]) { const [x, y] = ringAt(RIM_R + 21, deg); props.push(P('floodlight', x, y, 46, toGreen(x, y))); }
for (let deg = 28; deg <= 196; deg += 7) { const [x, y] = ringAt(RIM_R + 19, deg); props.push(P('flag-banner', x, y, 8, toGreen(x, y))); }
// a camera tower at each end of the arc
for (const deg of [ARC[0] - 10, ARC[1] + 10]) { const [x, y] = ringAt(STAND.fromR + 3, deg); props.push(P('camera-tower', x, y, 11.4, toGreen(x, y))); }
props.push(
  P('gate', ...ringAt(RIM_R + 34, 112), 14, toGreen(...ringAt(RIM_R + 34, 112))),
  P('tower', ...ringAt(RIM_R + 20, 14), 18, 0), P('tower', ...ringAt(RIM_R + 20, 208), 18, 0),
  // overhead: fireworks over the stadium and the harbour, an airship, a blimp, balloons
  P('fireworks', -190, 520, 46), P('fireworks', -140, 548, 58), P('fireworks', -86, 556, 50), P('fireworks', -34, 536, 44), P('fireworks', -230, 470, 40),
  P('fireworks', 10, 486, 38), P('fireworks', -110, 600, 64), P('fireworks', -160, 190, 36), P('fireworks', -100, 250, 30),
  P('airship', -60, 470, 32, 60), P('blimp', 60, 200, 28, 150), P('balloon', 120, 330, 20), P('balloon', -250, 240, 20), P('balloon', -20, 80, 18),
);

// ---- gadgets (docs/gadgets.md): what a swing can hit
//   SAFE    the Neon Mile, a speed strip up the Boulevard, runs a drive on toward the Skyway.
//   RISKY   the Harbour Ring hangs over the basin where a 115 to 128 mph drive at the flag
//           is starting to fall short of the quay: through it and the ball makes the Docks
//           (a longer drive passes over the top). The Docks' landing is a x3 ring.
//   the stadium green is a pinball table: the Kick-Off, a funnel in the middle of the
//           green, draws a ball that lands near it in toward the flag, and three bumpers
//           behind the green kick a ball that went long back at it.
//   ROCKET  coins over the harbour to the Helipad, along the Rocket's flight.
const harbourDrive = L.flight(height, TEE, PIN, { speedMph: 122, vla: 14, spin: 3000 });
const helipadRocket = L.flight(height, TEE, [-172, 330], { speedMph: 125, vla: 12, spin: 2600, ball: 'rocket' });
const gadgets = [
  L.gadget('strip', 'neon-mile', 33, 250, { size: [24, 50], heading: 354, strength: 7, maxMps: 16 }),
  harbourDrive.ring('harbour-ring', 150, { radius: 7, strength: 1.25 }),
  L.gadget('zone', 'docks-x3', -70, 268, { radius: 12, mult: 3 }),
  L.gadget('funnel', 'kick-off', -110, 432.5, { radius: 9, strength: 1 }),
  L.gadget('bumper', 'bumper-left', -124, 453.5, { radius: 1.6, height: 3.5, strength: 5 }),
  L.gadget('bumper', 'bumper-mid', -110, 457, { radius: 1.6, height: 3.5, strength: 5 }),
  L.gadget('bumper', 'bumper-right', -96, 453.5, { radius: 1.6, height: 3.5, strength: 5 }),
  helipadRocket.coins('harbour-coins', 80, 330, 7),
];

module.exports = {
  id: 'midnight-mile',
  stage: {
    number: 9, role: 'match', order: 9,
    name: 'Midnight Mile', theme: 'neon',
    origin: { lat: 34.0, lon: -160.0 },
    conditions: 'calm',
    wind: { min: 6, max: 14 },                   // it swirls between the towers (at 14 against, every route still goes with more club)
    timeOfDay: 'night',
    blurb: 'The finale. Rooftop tee, a harbour to cut, a stadium green behind a moat. Go big.',
    difficulty: 3,
  },
  extent: { minX: -300, minY: -110, maxX: 200, maxY: 620 },
  hole: {
    par: 5,
    name: 'Midnight Mile',
    line: LINE,
    note: 'Three ways home. Right of the water up the Boulevard and the Skyway is three safe shots. Straight at the flag is 215 yards over the basin to the Docks, then an iron over the moat. A Rocket reaches the Helipad, 11 degrees left.',
    greenNote: 'Sunk in the stadium behind the moat, tilted gently towards the water. Sand back left, back right and long of the Skyway.',
    routes: [
      { id: 'safe', name: 'The Boulevard', note: 'Right of the water all the way: up the street, along the Skyway, a wedge down into the stadium. No carry. Three shots.' },
      { id: 'risky', name: 'The Docks', note: 'Straight at the flag: 215 yards of carry over the basin to the low quay, water on three sides. Then a mid iron over the moat for an eagle putt.' },
      { id: 'rocket', name: 'The Helipad', note: 'Rocket ball only: 11 degrees left to the lit roof in the harbour, 370 to 430 yards out. It leaves a wedge straight down at the flag.' },
    ],
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    { kind: 'fairway', poly: boulevard },
    { kind: 'fairway', poly: stadiumLeg },
    { kind: 'fairway', poly: docks },
    { kind: 'fairway', poly: helipad },
    { kind: 'green', poly: green },
    ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
    { kind: 'water', poly: water },
  ],
  trees,
  woods: [],
  props,
  gadgets,
  // behind the skyline on every side
  obLine: L.rect(-290, -100, 190, 610),
  height,
  sea: false,
  probes: [
    { at: [-41, 0], kind: 'water', what: 'the canal beside the tee' },
    { at: [-120, 180], kind: 'water', what: 'the basin: the carry to the Docks' },
    { at: [-14, 250], kind: 'water', what: 'the arm between the Docks and the Skyway' },
    { at: [-150, 270], kind: 'water', what: 'the west arm, under the helipad tower' },
    { at: [-110, 375], kind: 'water', what: 'the moat in front of the green' },
    { at: [36, 225], kind: 'fairway', what: 'the Boulevard: the safe drive' },
    { at: [12, 225], kind: 'fairway', what: 'the left half of the Boulevard' },
    { at: [60, 225], kind: 'fairway', what: 'the right half of the Boulevard' },
    { at: [10, 340], kind: 'fairway', what: 'the Skyway: the safe second' },
    { at: [-48, 410], kind: 'fairway', what: 'the way down into the stadium' },
    { at: [-60, 240], kind: 'fairway', what: 'the Docks: the risky drive' },
    { at: [-83, 335], kind: 'fairway', what: 'the forecourt, short of the moat' },
    { at: [-172, 329], kind: 'fairway', what: 'the Helipad' },
    { at: [-172, 295], kind: 'rough', what: 'the parapet at the front of the helipad' },
    { at: [76, 232], kind: 'bunker', what: 'the bunker right of the drive' },
    { at: [-80, 447], kind: 'bunker', what: 'the bunker back right of the green' },
    { at: [-10, 100], kind: 'rough', what: 'the street between the tee and the canal' },
    { at: [-52, 360], kind: 'rough', what: 'the fan zone' },
    { at: [-110, 406], kind: 'rough', what: 'the bank between the moat and the green' },
    { at: [-110, 480], kind: 'rough', what: 'the stand behind the green' },
    { at: [90, 150], kind: 'rough', what: 'a wide miss right is still in play' },
    { at: [198, 230], kind: 'ob', what: 'the city blocks east of the Boulevard' },
    { at: [-110, 618], kind: 'ob', what: 'behind the stadium' },
  ],
  // for the tests: the shape of the place
  city: { green: G, teeH: TEE_H, padH: PAD_H, streetH: STREET_H, skywayH: SKYWAY_H, waterH: WATER_H, helipad, padRoof, docks, water, stand: STAND, standR, rimR: RIM_R, routeX },
};
