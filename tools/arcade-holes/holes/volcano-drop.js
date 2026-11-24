'use strict';
// Volcano Drop: par 3, 191 yd in plan, 34 m downhill. One swing from a shelf on the crater
// rim to a rock island in a lake of lava. Two fangs of rock, the Jaws, stand in the lake on
// the line: 34 m higher than the tee, a 21 m gate between them. Three ways to play it
// (hole.routes):
//   SAFE    the Ash Terrace: a wide mown shelf on a buttress of the west wall, the shortest
//           carry on the hole. A wedge across the lava from there, round the Jaws.
//   RISKY   Through the Jaws: straight at the flag, between the fangs: 130 yd of lava, then
//           the reef that runs out from the island (rock: dry, a chip left).
//   ROCKET  Over the Jaws: only a boosted ball flies higher than the fangs. From up there
//           the whole island is open.
// The lava is one `water` polygon: from the rim in to the island, wrapped round the island,
// the two reefs that run out from it to the fangs, and the terrace's buttress, and closed
// by a basalt spine that joins the island's back to the far wall (the course format has no
// polygons with holes). Its walls are inside it, so a ball that hits one is in the lava.
// Local metres, x east, y north; the tee is the origin and the hole plays due north.
// Heights are metres above the lava (the lava is exactly 0).

const L = require('../lib');
const D = require('../detail-a');

const TAU = Math.PI * 2;
const TEE = [0, 0];
const PIN = [0, 174.6];                        // 191 yd
const ISLE = [-8, 176];                        // the island's centre
const TEE_H = 40;                              // the tee shelf (a drop the camera can still see down)
const GREEN_H = 6;
const TERRACE_H = 26;
const FANG_H = TEE_H + 34;                     // the Jaws: higher than any plain ball flies
const FANGS = [[-19, 88], [19, 88]];
const FANG_R = 8.5, REEF_R = 13;               // a fang, and the low reef round its foot
const WALL_M = 16;                             // the crater wall: rim to lava within this, inside the rim line
const CLIFF_M = 6;                             // the island's and the reefs' cliffs
const SPINE = 0.12;                            // half-angle (rad) of the gap the spine fills, seen from the island

// ---- outlines
const craterRim = L.blob(-10, 131, 135, 128, { wobble: 0.03, seed: 7, n: 96 });
const islandTop = L.blob(ISLE[0], ISLE[1], 38, 29, { wobble: 0.05, seed: 5, n: 72 });
const terraceLand = L.blob(-84, 102, 29, 25, { wobble: 0.05, seed: 15, n: 48 });
const islandR = L.radiusOf(islandTop, ISLE), craterR = L.radiusOf(craterRim, ISLE);
// the nearest crossing of a ray from the island with a polygon (Infinity: it misses)
const nearR = (poly) => (theta) => {
  const dx = Math.cos(theta), dy = Math.sin(theta);
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0] - ISLE[0], ay = poly[j][1] - ISLE[1], ex = poly[i][0] - poly[j][0], ey = poly[i][1] - poly[j][1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
};
const terraceR = nearR(terraceLand);
// a reef: everything on a ray from the island out to the far side of the circle round a fang
const reefR = (theta) => {
  let best = 0;
  for (const [fx, fy] of FANGS) {
    const rho = Math.hypot(fx - ISLE[0], fy - ISLE[1]), d = theta - Math.atan2(fy - ISLE[1], fx - ISLE[0]);
    const across = rho * Math.sin(d), along = rho * Math.cos(d);
    if (along > 0 && Math.abs(across) < REEF_R) best = Math.max(best, along + Math.sqrt(REEF_R * REEF_R - across * across));
  }
  return best;
};
const dryR = (theta) => Math.max(islandR(theta), reefR(theta));
const outerR = (theta) => Math.min(craterR(theta), terraceR(theta));
const at = (r, a) => [ISLE[0] + r * Math.cos(a), ISLE[1] + r * Math.sin(a)];
const ring = (r, a0, a1, n) => Array.from({ length: n + 1 }, (_, k) => { const a = L.lerp(a0, a1, k / n); return at(r(a), a); });
// the lava: from the dry ground round the island out to the rim (or the terrace), all the
// way round but for the spine due north of the island
const A0 = Math.PI / 2 + SPINE, A1 = Math.PI / 2 + TAU - SPINE;
const lava = L.ensureCCW([...ring(outerR, A0, A1, 300), ...ring(dryR, A0, A1, 300).reverse()]);
const dryLand = ring(dryR, 0, TAU, 300).slice(1);                            // the island and its two reefs
// the terrace's buttress: the terrace, and everything behind it out to the crater wall
const TERRACE_A = Math.atan2(102 - ISLE[1], -84 - ISLE[0]);
const buttress = (() => {
  const front = [], back = [];
  for (let k = 0; k <= 80; k++) {
    const a = TERRACE_A + L.lerp(-0.42, 0.42, k / 80);
    if (!Number.isFinite(terraceR(a))) continue;
    front.push(at(terraceR(a), a));
    back.push(at(craterR(a) + 14, a));
  }
  return L.ensureCCW([...front, ...back.reverse()]);
})();

// ---- surfaces
const tee = L.rect(-6, -8, 6, 2);                 // the ball two metres from the edge: the island is in view
const teePad = L.blob(0, -9, 32, 17, { wobble: 0.04, seed: 2 });
const green = L.blob(-4, 177, 18, 16, { wobble: 0.05, seed: 3 });           // 36 x 32 m
const wing = L.blob(-33, 176, 9, 13, { wobble: 0.05, seed: 13 });           // the island's mown west wing
const terrace = L.blob(-84, 102, 24, 20, { wobble: 0.05, seed: 16 });       // the Ash Terrace: 48 x 40 m
const pot = L.blob(5, 158.5, 6, 3.2, { wobble: 0.06, seed: 9 });            // in front of the flag
const ashTrap = L.blob(-106, 92, 4.5, 9, { wobble: 0.08, seed: 19, rotDeg: 30 });   // the back of the terrace

// ---- ground
const sdRim = D.sdf(craterRim, 200), sdIsle = D.sdf(islandTop, 10), sdDry = D.sdf(dryLand, 10);
const sdButtress = D.sdf(buttress, 18), sdTerrace = D.sdf(terraceLand, 60), sdPad = D.sdf(teePad, 12);
const sdPot = D.sdf(pot, 5), sdTrap = D.sdf(ashTrap, 5);
const rimNoise = L.fbm({ seed: 301, scaleM: 42, octaves: 3 });
const flankNoise = L.fbm({ seed: 302, scaleM: 85, octaves: 3 });
const rockNoise = L.fbm({ seed: 303, scaleM: 11, octaves: 2 });
const islandPlane = L.plane(GREEN_H, PIN, 0.004, 0.012);                    // 1.3 %, falling to the tee
const SPINE_R0 = islandR(Math.PI / 2), SPINE_R1 = craterR(Math.PI / 2);

// the rim's crest: lowest at the tee, 30 m higher behind the island, jagged all round
const crest = (x, y) => TEE_H + 30 * L.smoothstep(-10, 270, y) + 6 * rimNoise(x, y);

function height(x, y) {
  const inCrater = sdRim(x, y);                                 // + inside the rim line
  // the rim (a few metres of level crest), and the mountain's flank falling away outside it
  let land = crest(x, y);
  if (inCrater < 0) land = Math.max(16 + 4 * flankNoise(x, y), land - D.terrace(0.5 * Math.max(0, -inCrater - 6), 7, 0.4));
  const pad = D.inside(sdPad(x, y), 10);
  if (pad) land = L.lerp(land, TEE_H, pad);
  // the crater wall, then the lake: exactly level
  let h = L.lerp(land, 0, L.smoothstep(0, WALL_M, inCrater));

  // the Ash Terrace on its buttress: level, then a bank up to the wall behind it
  const onButtress = sdButtress(x, y);
  if (onButtress > -15) {
    const back = L.smoothstep(4, 34, -sdTerrace(x, y));         // 0 on the terrace .. 1 at the wall
    let top = L.lerp(TERRACE_H + 0.4 * rimNoise(x * 2, y * 2), land, back);
    const trap = sdTrap(x, y);
    if (trap > 0) top -= 0.45 * L.smoothstep(0, 2.5, trap);
    h = Math.max(h, top * (1 - L.smoothstep(0, 14, -onButtress)));
  }

  // the island, the reefs and the Jaws
  const onDry = sdDry(x, y);
  if (onDry > -CLIFF_M - 2) {
    // the reefs: low broken rock; the island: a tilted top
    let top = 3.6 + 0.9 * rockNoise(x, y);
    const isle = D.inside(sdIsle(x, y), 5);
    if (isle) top = L.lerp(top, islandPlane(x, y), isle);
    const sand = sdPot(x, y);
    if (sand > 0) top -= 0.45 * L.smoothstep(0, 2.5, sand);
    for (const [fx, fy] of FANGS) {
      // a fang: sheer, its crown a cone (nowhere on it is a place for a ball to stay)
      const q = Math.hypot(x - fx, y - fy), a = Math.atan2(y - fy, x - fx);
      const r = FANG_R + 0.9 * Math.sin(3 * a + fx) + 0.6 * Math.sin(5 * a);
      if (q < r) top = Math.max(top, (FANG_H + 1.1 * Math.max(0, r - 3 - q) + rockNoise(x, y)) * L.smoothstep(r, r - 3, q));
    }
    h = Math.max(h, top * (1 - L.smoothstep(0, CLIFF_M, -onDry)));
  }

  // the spine: a blade of basalt from the island's back to the far wall
  const dx = x - ISLE[0], dy = y - ISLE[1], r = Math.hypot(dx, dy);
  if (dy > 0 && r > SPINE_R0 - 2 && r < SPINE_R1 + 2) {
    const t = L.clamp((r - SPINE_R0) / (SPINE_R1 - SPINE_R0), 0, 1);
    const half = r * Math.sin(SPINE);                           // the gap's half-width here
    const across = Math.abs(dx);
    const top = L.lerp(L.lerp(5.6, 3.4, L.smoothstep(0, 0.3, t)), crest(x, y), L.smoothstep(0.5, 1, t));
    h = Math.max(h, top * (1 - L.smoothstep(0.55 * half, 1.75 * half, across)));
  }
  return h;
}

const surfaces = [
  { kind: 'tee', poly: tee },
  { kind: 'green', poly: green },
  { kind: 'fairway', poly: wing },
  { kind: 'fairway', poly: terrace },
  { kind: 'bunker', poly: pot },
  { kind: 'bunker', poly: ashTrap },
  { kind: 'water', poly: lava },
];

// scorched trees down the mountain's outer flank, well clear of the line
const gentle = (x, y) => D.slopeOf(height, x, y) < 0.45;
const trees = D.cleanTrees([
  ...L.clusterTrees(-104, -48, { count: 8, radius: 18, seed: 51 }),
  ...L.clusterTrees(108, -50, { count: 8, radius: 18, seed: 52 }),
  ...L.clusterTrees(-178, 60, { count: 6, radius: 14, seed: 53 }),
  ...L.clusterTrees(160, 70, { count: 6, radius: 14, seed: 54 }),
  ...L.clusterTrees(-60, -64, { count: 5, radius: 10, seed: 55 }),
  ...L.clusterTrees(52, -66, { count: 5, radius: 10, seed: 56 }),
], { surfaces, tee: TEE, pin: PIN, clearM: 6, lineM: 24, ok: gentle });

// ---- props
const P = D.P;
const face = (kind, x, y, heightM, to) => P(kind, x, y, heightM, L.facing(x, y, to[0], to[1]));
const LAKE = [-10, 130];
// a lava fall stands at the foot of the wall, in the lake, and faces the middle of it
const fall = (deg, heightM) => { const a = deg * Math.PI / 180, [x, y] = at(craterR(a) - WALL_M + 2, a); return face('lava-fall', x, y, heightM, LAKE); };
const rocks = (list) => list.map(([x, y, h, rot]) => P('lava-rock', x, y, h, rot));
const props = D.clean([
  // lava pouring down the crater's walls, all the way round
  fall(20, 46), fall(52, 50), fall(118, 52), fall(150, 48), fall(182, 44), fall(238, 36), fall(318, 36), fall(350, 42),
  // a dragon on the right fang, watching the tee; a nest of bones on the left one
  face('dragon', FANGS[1][0], FANGS[1][1], 16, TEE), P('crystal', FANGS[0][0], FANGS[0][1], 7, 40),
  // rocks standing in the lava: the carry, both sides of the island, behind it
  ...rocks([[-42, 44, 6, 20], [38, 52, 7.5, 140], [-66, 150, 5, 260], [62, 118, 6.5, 70], [48, 96, 5, 310], [36, 128, 4.5, 190], [-52, 60, 5, 95],
    [58, 166, 7, 230], [74, 208, 9, 15], [-96, 208, 7, 170], [38, 226, 6, 285], [-58, 232, 8.5, 60], [-12, 40, 5, 120], [60, 30, 5.5, 340],
    [92, 150, 5, 205], [-112, 170, 6, 30], [-40, 128, 4, 75], [96, 96, 6, 100], [-118, 236, 7, 10], [100, 232, 6.5, 200], [14, 56, 4, 300], [-124, 140, 5, 150]]),
  // on the rim either side of the tee, on the reefs and the island's back edge
  ...rocks([[-30, 2, 4.5, 80], [31, 1, 5, 250], [-60, 10, 6, 10], [58, 12, 6.5, 300], [-52, 193, 3.5, 150], [6, 201, 3, 45], [-26, 112, 3, 0], [24, 114, 3, 90], [-20, 136, 2.5, 200], [14, 138, 2.5, 20]]),
  // torches: a gate at the tee, a ring round the green, the terrace's edge, the spine
  P('torch', -9, 8, 3.2), P('torch', 9, 8, 3.2), P('torch', -9, -8, 3.2), P('torch', 9, -8, 3.2), P('torch', -15, 9, 2.6), P('torch', 15, 9, 2.6),
  P('torch', -22, 196, 3), P('torch', 12, 195, 3), P('torch', 19, 178, 3), P('torch', -14, 155, 3), P('torch', -45, 162, 3), P('torch', -45, 190, 3),
  P('torch', -14, 222, 3.4), P('torch', -4, 222, 3.4),
  ...D.ringOf('torch', -84, 102, 27.5, 12, { h: 3, seed: 4 }),
  // the ruined temple on the terrace's bank, its idol and its gate
  face('ruins', -116, 112, 10, [-84, 102]), face('ruins', -104, 74, 8, [-84, 102]), face('statue', -112, 96, 7, [-84, 102]), face('gate', -64, 84, 9, [0, 40]),
  P('idol', -126, 86, 9, 110), P('tower', -140, 60, 14, 0),
  // crystals: growing out of the rim by the tee, the island's back, the spine, the far wall
  P('crystal', -19, -4, 3.5, 30), P('crystal', -23, -9, 5, 200), P('crystal', 20, -5, 4, 110), P('crystal', 25, -11, 5.5, 320),
  P('crystal', -10, 201, 4.5, 75), P('crystal', -34, 199, 3.5, 250), P('crystal', 18, 190, 3, 160), P('crystal', -40, 198, 2.6, 10), P('crystal', 26, 170, 2.8, 300),
  P('crystal', -12, 234, 6, 20), P('crystal', -16, 250, 7.5, 280), P('crystal', -4, 252, 6.5, 130), P('crystal', -9, 266, 8, 60),
  ...D.scatter('crystal', { x: -150, y: 150, r: 14, ry: 60 }, 7, { h: [6, 11], seed: 21, minGap: 10 }),
  ...D.scatter('crystal', { x: 132, y: 160, r: 14, ry: 60 }, 7, { h: [6, 11], seed: 22, minGap: 10 }),
  ...D.scatter('crystal', { x: -10, y: 292, r: 80, ry: 12 }, 8, { h: [7, 12], seed: 23, minGap: 12 }),
  ...D.scatter('crystal', { x: -84, y: 102, r: 40, ry: 34 }, 6, { h: [2.5, 5], seed: 24, minGap: 8, keep: (x, y) => L.signedDistance(x, y, terraceLand) < -3 }),
  // the event: a crowd behind the tee, a screen and fireworks on the far rim
  face('crowd', -19, -16, 3, PIN), face('crowd', 19, -16, 3, PIN), face('grandstand', -58, -24, 10, [0, 60]), face('grandstand', 60, -26, 10, [0, 60]),
  face('jumbotron', 44, 296, 16, TEE), P('flag-banner', -16, -2, 6, 0), P('flag-banner', 16, -2, 6, 0), P('fireworks', -60, 300, 30, 0), P('fireworks', 20, 310, 30, 0),
  // the range beyond: more cones on the horizon, ash in the air
  P('volcano', -330, 760, 150, 0), P('volcano', 470, 600, 130, 40), P('volcano', -640, 260, 140, 200), P('volcano', 560, -100, 120, 90),
  P('cloud', -160, 240, 50, 0), P('cloud', 140, 320, 56, 0), P('cloud', 40, 520, 60, 0), P('cloud', -260, 40, 48, 0), P('cloud', 240, 90, 46, 0),
  P('bird-flock', -10, 100, 8, 0), P('bird-flock', 80, 180, 8, 120), P('bird-flock', -100, 60, 8, 240), P('airship', 150, 380, 30, 250),
], { surfaces, tee: TEE, pin: PIN, dry: gentle });

module.exports = {
  id: 'volcano-drop',
  extent: { minX: -215, minY: -95, maxX: 195, maxY: 345 },
  hole: {
    par: 3,
    name: 'Volcano Drop',
    line: [TEE, PIN],
    note: 'From the crater rim, 34 metres down to an island in the lava: it plays two clubs shorter than its 191 yards. The Jaws stand on the line: go between them, or left to the Ash Terrace. A reef catches a ball just short; long and wide melt.',
    greenNote: 'Seen through the Jaws, a pot bunker in front of the flag. From the Ash Terrace it is a wedge across the lava, with nothing in the way.',
    routes: [
      { id: 'safe', name: 'The Ash Terrace', note: 'Left, to the wide shelf on the west wall: the shortest carry. Then a wedge across, round the Jaws.' },
      { id: 'risky', name: 'Through the Jaws', note: 'Straight at the flag between the fangs: a 21 metre gate, 100 yards out. All carry.' },
      { id: 'rocket', name: 'Over the Jaws', note: 'Only a Rocket flies higher than the fangs. From up there the whole island is open.' },
    ],
  },
  surfaces,
  trees,
  woods: [],
  props,
  // the outer flank, well beyond the rim: out of bounds is not a way to lose a ball here
  obLine: L.rect(-198, -78, 178, 328),
  height,
  sea: false,
  probes: [
    { at: [0, 60], kind: 'water', what: 'the carry over the lava' },
    { at: [0, 12], kind: 'water', what: 'the crater wall below the tee' },
    { at: [0, 100], kind: 'water', what: 'the lava in the gate of the Jaws' },
    { at: [-110, 190], kind: 'water', what: 'the lava left of the island' },
    { at: [70, 150], kind: 'water', what: 'the lava right of the island' },
    { at: [34, 174], kind: 'water', what: 'the cliff right of the green' },
    { at: [5, 240], kind: 'water', what: 'long' },
    { at: [-50, 130], kind: 'water', what: 'the lava between the terrace and the island' },
    { at: [5, 158.5], kind: 'bunker', what: 'the pot bunker' },
    { at: [-33, 176], kind: 'fairway', what: 'the island\'s west wing' },
    { at: [-84, 102], kind: 'fairway', what: 'the Ash Terrace' },
    { at: [-19, 100], kind: 'rough', what: 'the reef under the left fang' },
    { at: [19, 88], kind: 'rough', what: 'the right fang' },
    { at: [-12, 199], kind: 'rough', what: 'the back of the island' },
    { at: [-8, 232], kind: 'rough', what: 'the spine' },
    { at: [0, -12], kind: 'rough', what: 'the tee shelf' },
    { at: [-205, 100], kind: 'ob', what: 'far down the west flank' },
  ],
  stage: {
    number: 4, role: 'match', order: 4,
    name: 'Volcano Drop', theme: 'volcano',
    origin: { lat: 44.0, lon: -150.0 },          // open North Pacific
    conditions: 'calm',
    wind: { min: 4, max: 12 },
    baseM: 800,
    timeOfDay: 'dusk',
    blurb: 'From the crater rim to an island in the lava: through the Jaws, or a Rocket over them.',
    difficulty: 3,
  },
};
