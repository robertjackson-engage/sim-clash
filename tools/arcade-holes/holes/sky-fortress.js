'use strict';
// Sky Fortress: a ROCKET par 3. 427 yd in plan and 50 m straight up: from a launch platform
// on the canyon floor to a green in the courtyard of a fortress, on top of a butte that
// stands in a flooded gorge. Only the stage's free Rocket ball gets there in one (a ball
// speed of about 118 mph or more, boosted, carries the 288 m to the lip; a plain driver
// never rises above 30 m).
//
// The butte rises sheer out of the water on every side but one. Up its south face, straight
// at the tee, runs the Siege Ramp: 200 m of scree at 42 % with the Rampart, a level ledge,
// half way up it. A Rocket that comes up short lands on the ramp and is pitched on up it; a
// plain ball climbs it in three or four. Either side of the top a bastion, 12 m lower, takes
// the Rocket that is pulled or pushed.
//   the floor (10), the launch platform (32)
//   the Siege Ramp        10 -> 46, the Rampart ledge (46), 46 -> 82: rough, it holds a ball
//   the top (82)          the courtyard (fairway), the green, the keep behind it (94)
//   the bastions (70)     left and right of the top, a scree bank up to it
//   the lake (0)          everything else: in the water is a stroke, dropped where the ball
//                         last flew over land (the lake reaches up every cliff to its lip)
// Why ramps and not walls: the game lets a player aim 45 degrees either side of the flag and
// no further, so a ball lying under a wall with the flag beyond it could never be played out.
// Every slope that must be climbed is scree a ball can stop on; every cliff drops into water.
// Local metres, x east, y north; the tee is the origin and the hole plays due north.
// Heights are metres above the lake.

const L = require('../lib');

const TEE = [0, 0];
const PIN = [0, 390];                                    // 427 yd
const FLOOR = 10, TEE_H = 32, RAMPART = 46, BASTION = 70, TOP = 82, KEEP = 94;
const SHORE = 96;                                        // the lake begins here (y)
const SCREE = 0.43;                                      // the bank from a bastion up to the top

// ---- outlines
const top = L.blob(0, 385, 58, 97, { wobble: 0.025, seed: 15, n: 80 });
const keep = L.blob(0, 474, 34, 15, { wobble: 0.04, seed: 16, n: 40 });
const teePad = L.blob(0, -4, 24, 20, { wobble: 0.05, seed: 17, n: 40 });
// the butte's whole footprint: the ramp, the top, the bastions. Outside it, north of the
// shore, is the lake.
const butte = L.roundCorners([[42, 82], [38, 200], [40, 276], [64, 300], [124, 328], [128, 452], [62, 474], [40, 494],
  [-40, 494], [-62, 474], [-128, 452], [-124, 328], [-64, 300], [-40, 276], [-38, 200], [-42, 82]], 10);
const lake = [[-254, SHORE], [-43, SHORE], ...[...butte].reverse().filter(([, y]) => y > SHORE + 3), [43, SHORE], [254, SHORE], [254, 592], [-254, 592]];
// buttes on the dry floor (scenery: nothing to aim at)
const outliers = [
  { poly: L.blob(-176, 44, 28, 32, { wobble: 0.08, seed: 24, n: 40 }), level: 62, cliffM: 10 },
  { poly: L.blob(156, 34, 22, 28, { wobble: 0.08, seed: 23, n: 40 }), level: 54, cliffM: 9 },
  { poly: L.blob(-120, -66, 30, 18, { wobble: 0.08, seed: 25, n: 40 }), level: 46, cliffM: 9 },
  { poly: L.blob(122, -72, 26, 16, { wobble: 0.08, seed: 26, n: 40 }), level: 50, cliffM: 9 },
];

// ---- surfaces
const tee = L.rect(-6, -5, 6, 5);
const floorFairway = L.roundCorners(L.rect(-36, 34, 36, 76), 12);             // short of the ramp
const rampartFairway = L.roundCorners(L.rect(-31, 171, 31, 197), 8);          // the ledge half way up: 62 x 26 m
const westBastion = L.blob(-104, 390, 12, 44, { wobble: 0.03, seed: 35 });
const eastBastion = L.blob(104, 390, 12, 44, { wobble: 0.03, seed: 36 });
const courtyard = L.blob(0, 334, 40, 36, { wobble: 0.03, seed: 37 });         // where a 125 mph Rocket lands
const green = L.blob(0, 390, 19, 18, { wobble: 0.04, seed: 38 });             // 38 x 36 m
const greenApron = L.offsetPolygon(green, 5);
const bunkers = [
  L.blob(-33, 388, 7, 10, { wobble: 0.08, seed: 41 }),
  L.blob(33, 396, 7, 9, { wobble: 0.08, seed: 42 }),
  L.blob(2, 426, 13, 6, { wobble: 0.08, seed: 43 }),                          // long: sand stops a 150 mph Rocket
];
const fairways = [floorFairway, rampartFairway, westBastion, eastBastion, courtyard, greenApron];
const mown = [tee, green, ...fairways, ...bunkers];

// ---- ground
const dunes = L.fbm({ seed: 1001, scaleM: 64, octaves: 3 });
const ripples = L.fbm({ seed: 1002, scaleM: 19, octaves: 2 });
const crags = L.ridged({ seed: 1003, scaleM: 90, octaves: 3 });
const rockNoise = L.fbm({ seed: 1004, scaleM: 26, octaves: 2 });
const warpA = L.fbm({ seed: 1011, scaleM: 40, octaves: 2 }), warpB = L.fbm({ seed: 1012, scaleM: 40, octaves: 2 });
const warp = (x, y) => [3 * warpA(x, y), 3 * warpB(x, y)];
const scenery = L.tiers(outliers, { warp });
const crown = L.tiers([{ poly: keep, level: KEEP, cliffM: 6 }]);
const platform = L.tiers([{ poly: teePad, level: TEE_H, cliffM: 10 }]);
const offMown = L.awayFrom(mown, 5, 16);
const butteSd = L.nearField(butte, 8), lakeSd = L.nearField(lake, 4), topSd = L.nearField(top, 80);
const WASH = [[70, -96], [58, 10], [96, 60], [150, 96]];
const greenPlane = L.plane(TOP, PIN, 0.004, 0.011);                           // 1.2 %, falling to the front

// the Siege Ramp, by distance up it: floor, scree, the Rampart, scree, the top
const RAMP = [[82, FLOOR], [166, RAMPART], [202, RAMPART], [288, TOP]];
function rampHeight(y) {
  if (y <= RAMP[0][0]) return FLOOR;
  for (let i = 1; i < RAMP.length; i++) if (y <= RAMP[i][0]) return L.lerp(RAMP[i - 1][1], RAMP[i][1], (y - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0]));
  return TOP;
}
// the butte's own height: the ramp south of the top, the top, and round it a scree bank
// down to the bastions
function butteHeight(x, y) {
  const out = -topSd(x, y);
  const side = out <= 0 ? TOP : Math.max(BASTION, TOP - SCREE * out);
  if (y >= 300) return side;
  return y < 270 ? rampHeight(y) : Math.max(rampHeight(y), Math.abs(x) < 30 ? 0 : side);
}

// the canyon's own walls: west, east, north and, lower, south
function wallAt(x, y) {
  const n = 14 * dunes(x * 0.7 + 400, y * 0.7 - 300);
  const w = Math.max(L.smoothstep(-238, -270, x + n), L.smoothstep(240, 272, x + n), L.smoothstep(580, 610, y + n));
  const s = L.smoothstep(-84, -106, y + n);
  return { w: Math.max(w, s), top: w >= s ? 74 + 30 * crags(x, y) : 44 + 16 * crags(x, y) };
}

function height(x, y) {
  // the canyon floor: rippled, a dry wash wandering down it to the lake
  let h = FLOOR + 0.02 * Math.max(0, SHORE - y) + 1.5 * dunes(x, y) + 0.5 * ripples(x, y);
  const wash = L.distToPolyline(x, y, WASH);
  if (wash < 15) h -= 2.4 * (1 - (wash / 15) ** 2) ** 2;
  const wall = wallAt(x, y);
  if (wall.w) h = L.lerp(h, wall.top, wall.w);
  h = scenery.apply(x, y, h);
  // the butte
  const inside = L.smoothstep(-5, 0, butteSd(x, y));
  let scree = 0;
  if (inside) {
    const b = butteHeight(x, y);
    h = L.lerp(h, b, inside);
    scree = b > FLOOR + 1 && b < TOP - 0.5 && b !== RAMPART && b !== BASTION ? 1 : 0;
  }
  h = crown.apply(x, y, h);
  h = platform.apply(x, y, h);
  // rock: strata cut into every cliff, rubble on the scree and the open tops; nothing within
  // a few metres of mown ground
  const off = offMown(x, y);
  if (off) {
    const cliff = Math.max(crown.cliff(x, y), scenery.cliff(x, y), platform.cliff(x, y), 4 * wall.w * (1 - wall.w));
    if (cliff) h = L.lerp(h, L.strata(h + 1.6 * rockNoise(x, y), 7, 0.8), 0.9 * cliff * off);
    h += off * (1 - cliff) * (scree ? 0.9 : 0.6) * rockNoise(x + 70, y - 40);
  }
  // the green, tilted to the front; sand in hollows
  const onGreen = L.plateauWeight(x, y, greenApron, 6);
  if (onGreen) h = L.lerp(h, greenPlane(x, y), onGreen);
  for (const b of bunkers) {
    const sand = L.signedDistance(x, y, b);
    if (sand > 0) h -= 0.55 * L.smoothstep(0, 3, sand);
  }
  // the lake: exactly level, and every cliff that stands in it falls to it INSIDE its outline
  // (so a ball that goes over an edge is in the water, and is dropped back on top)
  const wet = lakeSd(x, y);
  if (wet > 0) h = L.lerp(h, 0, L.clamp((wet - 2.5) / 3, 0, 1));    // (level for 2.5 m inside the outline: a drop on the lip stands on flat rock)
  return h;
}

// ---- trees: desert scrub on the canyon floor, well clear of the line of play
const openFloor = (x, y) => y < SHORE - 12 && y > -80 && Math.abs(x) < 232 && scenery.cliff(x, y) === 0 && scenery.on(x, y) < 0 &&
  platform.cliff(x, y) === 0 && platform.on(x, y) < 0 && wallAt(x, y).w === 0 && butteSd(x, y) < -8;
const trees = [
  ...L.scatterTrees(L.rect(48, -76, 232, 84), { spacing: 26, jitter: 0.45, seed: 61, avoid: mown, clearM: 8, keep: openFloor }),
  ...L.scatterTrees(L.rect(-232, -76, -48, 84), { spacing: 27, jitter: 0.45, seed: 62, avoid: mown, clearM: 8, keep: openFloor }),
].map(([x, y], i) => [x, y, 5 + (i % 5) * 0.8, 2.2 + (i % 3) * 0.5]);
// cottonwoods along the shore, either side of the ramp
const woods = [
  L.roundCorners(L.rect(-228, 66, -84, 88), 8),
  L.roundCorners(L.rect(84, 66, 228, 88), 8),
];

// ---- props
const props = [];
const lineClear = (x, y, m) => L.distToSegment(x, y, TEE[0], TEE[1], PIN[0], PIN[1]) >= m;
const offPlay = (x, y, m = 3) => mown.every((poly) => L.signedDistance(x, y, poly) < -m);
// put a prop where it may stand (rough or water, clear of the line); skips a spot that is not
const P = (kind, x, y, heightM, rotDeg = 0) => {
  const floats = L.FLOATING_PROP_KINDS.includes(kind);
  if (!floats && !(offPlay(x, y) && lineClear(x, y, L.SLIM_PROP_KINDS.includes(kind) ? 6 : 9))) return false;
  props.push(L.prop(kind, x, y, { heightM, rotDeg }));
  return true;
};
const toward = (x, y, tx, ty) => L.facing(x, y, tx, ty);
const onLake = (x, y) => L.signedDistance(x, y, lake) > 8 && Math.abs(x) < 236 && y < 576;

// the launch platform: twin ramps either side of the line, a camp and a crowd behind the tee
P('launch-ramp', -18, 13, 7.5); P('launch-ramp', 18, 13, 7.5);
P('crowd', 0, -17, 3, toward(0, -17, 0, 0));
for (const s of [-1, 1]) {
  P('flag-banner', s * 9, -9, 8, s * 15); P('flag-banner', s * 19, 0, 9, s * 30); P('flag-banner', s * 20, -12, 8, s * 40);
  P('torch', s * 8.5, 7.5, 3.2); P('torch', s * 8.5, -7.5, 3.2);
  P('hut', s * 15, -17, 4.5, toward(s * 15, -17, 0, 0));
}
// the Siege Ramp: torches and banners up both edges, statues on the Rampart, ruins of the
// siege works at its foot
for (let y = 92; y <= 280; y += 17) {
  const half = L.lerp(38, 35, (y - 82) / 206);
  P('torch', -half, y, 3.4); P('torch', half, y, 3.4);
}
for (const y of [104, 150, 222, 262]) { P('flag-banner', -32, y, 8, 20); P('flag-banner', 32, y, 8, -20); }
P('statue', -35, 184, 11, toward(-35, 184, 0, 0)); P('statue', 35, 184, 11, toward(35, 184, 0, 0));
P('ruins', -60, 70, 8, 30); P('ruins', 62, 66, 7, 140); P('ruins', -30, 128, 6, 80); P('ruins', 30, 240, 6, 200);
// boulders and scrub up the scree, off the line
for (const [x, y, hM] of [[-28, 108, 7], [30, 122, 6], [-24, 146, 8], [26, 158, 6], [-26, 214, 7], [28, 226, 8], [-22, 252, 6], [24, 266, 7]]) P('rock-spire', x, y, hM, (x * 7 + y) % 360);
for (const [x, y] of [[-20, 98], [22, 104], [-30, 136], [18, 140], [-18, 160], [32, 208], [-30, 236], [20, 248], [-28, 270], [30, 280]]) P('cactus', x, y, 3 + ((x + y) % 3) * 0.8, (x * 5 + y) % 360);
P('tower', -72, 60, 15); P('tower', 74, 58, 15);
// the fortress: the keep behind the green, gate towers at the head of the ramp, towers on the wall
P('castle', 0, 474, 46, 0);
P('tower', -24, 294, 24); P('tower', 24, 294, 24);
P('tower', -37, 312, 22); P('tower', 37, 312, 22); P('tower', -42, 446, 26); P('tower', 42, 446, 26);
P('gate', -54, 388, 13, toward(-54, 388, -120, 388)); P('gate', 54, 388, 13, toward(54, 388, 120, 388));
P('statue', -44, 358, 11, toward(-44, 358, 0, 300)); P('statue', 44, 358, 11, toward(44, 358, 0, 300));
P('crowd', -47, 414, 3.4, toward(-47, 414, 0, 392)); P('crowd', 47, 418, 3.4, toward(47, 418, 0, 392));
P('crowd', -30, 448, 3.2, toward(-30, 448, 0, 392)); P('crowd', 30, 450, 3.2, toward(30, 450, 0, 392));
for (let k = 0; k < 26; k++) {
  const a = (k / 26) * 2 * Math.PI;
  P('flag-banner', 53 * Math.cos(a), 385 + 91 * Math.sin(a), 9, (k * 47) % 360);
}
for (let k = 0; k < 12; k++) {
  const a = (k / 12) * 2 * Math.PI + 0.26;
  P('torch', 28 * Math.cos(a), 390 + 27 * Math.sin(a), 3.4);
}
for (const y of [304, 322, 340, 358]) { P('torch', -44, y, 3.2); P('torch', 44, y, 3.2); }
// the bastions: a watchtower at each corner, banners and torches on the lip
for (const s of [-1, 1]) {
  P('tower', s * 119, 338, 18); P('tower', s * 122, 444, 18);
  for (const y of [352, 372, 392, 412, 432]) P('torch', s * 121, y, 3);
  for (const y of [362, 402, 440]) P('flag-banner', s * 88, y, 7.5, s * 90);
  P('ruins', s * 78, 322, 7, s * 40);
}
// the lake: boats, pinnacles standing in the water, falls down the butte's faces
for (const [x, y, hM, rot] of [[-150, 150, 6, 30], [170, 180, 6.5, 300], [-196, 330, 6, 10], [186, 420, 7, 190], [-90, 540, 6, 80], [110, 548, 6.5, 250], [150, 280, 6, 120]]) if (onLake(x, y)) P('boat', x, y, hM, rot);
for (const [x, y, hM] of [[-104, 140, 22], [112, 132, 26], [-176, 232, 30], [190, 250, 24], [-214, 430, 34], [206, 500, 30], [-150, 520, 26], [60, 556, 28],
  [-40, 560, 22], [-92, 230, 16], [96, 220, 18], [224, 330, 28], [-226, 180, 24]]) if (onLake(x, y)) P('rock-spire', x, y, hM, (x * 3 + y) % 360);
P('waterfall', 133, 390, 66, toward(133, 390, 240, 390)); P('waterfall', -133, 390, 66, toward(-133, 390, -240, 390));
P('waterfall', 0, 500, 78, toward(0, 500, 0, 600)); P('waterfall', -246, 300, 70, toward(-246, 300, -100, 300)); P('waterfall', 248, 440, 70, toward(248, 440, 100, 440));
// the dry floor: cacti, spires, arches, a camp by the wash
const floorSpots = L.scatterTrees(L.rect(-232, -80, 232, 84), { spacing: 24, jitter: 0.48, seed: 71, keep: (x, y) => openFloor(x, y) && offPlay(x, y, 6) && lineClear(x, y, 14) && woods.every((w) => L.signedDistance(x, y, w) < -3) })
  .filter(([x, y]) => trees.every((t) => Math.hypot(t[0] - x, t[1] - y) > 7));
floorSpots.forEach(([x, y], i) => { if (i % 3 === 0) P('cactus', x, y, 3.4 + (i % 5) * 0.9, (i * 67) % 360); });
for (const [x, y, hM] of [[-84, 30, 20], [-64, -40, 16], [36, 28, 14], [104, 20, 22], [-226, 0, 28], [220, -30, 26], [-140, 78, 18], [200, 70, 20]]) P('rock-spire', x, y, hM, (x * 3 + y) % 360);
P('rock-arch', 92, -20, 20, 70); P('rock-arch', -128, 4, 17, 120); P('rock-arch', 196, 20, 22, 10);
P('hut', 52, -38, 4.5, 200); P('hut', 64, -30, 4.5, 250); P('hut', 44, -52, 4.2, 150); P('windmill', 84, -48, 16, toward(84, -48, 0, 0));
// in the air
P('fireworks', -18, 478, 40); P('fireworks', 22, 470, 46); P('fireworks', 0, 500, 36);
P('airship', -160, 330, 26, 110); P('balloon', 170, 230, 22); P('balloon', -206, 140, 20); P('balloon', 150, 524, 24); P('balloon', -150, 560, 22);
P('bird-flock', -80, 200, 9, 40); P('bird-flock', 110, 310, 8, 300); P('bird-flock', -170, 450, 10, 120);
P('cloud', -200, 420, 16); P('cloud', 180, 480, 14); P('cloud', 20, 570, 18); P('cloud', -90, 110, 12);
// the country beyond: mesas, spires and arches on every horizon
for (const [x, y, hM, rot] of [[-420, 300, 110, 20], [-520, 640, 150, 80], [-180, 860, 170, 140], [220, 900, 190, 10], [520, 560, 140, 200], [460, 180, 120, 260],
  [430, -160, 100, 300], [-400, -140, 110, 40], [0, -330, 90, 170], [60, 1100, 230, 60]]) P('mesa', x, y, hM, rot);
for (const [x, y, hM] of [[-360, 480, 60], [-340, 90, 54], [380, 380, 64], [360, 40, 50], [-90, 720, 70], [140, 740, 76], [330, 660, 58], [-300, 720, 66]]) P('rock-spire', x, y, hM, (x + y) % 360);
P('rock-arch', -380, 600, 44, 60); P('rock-arch', 400, 760, 50, 300);

// ---- gadgets (docs/gadgets.md): what a swing can hit
//   ROCKET  coins up the full Rocket's flight; the courtyard is a x3 landing. Nothing hangs
//           in the Rocket's way: the hero carry is the hole.
//   SAFE    two ways up for a ball that comes up short. The Great Bombard, a cannon on the
//           Rampart ledge: a ball that comes down on it (a plain drive of about 140 mph, a
//           Rocket struck at 80, a pitch from the lower ramp) is fired up into the courtyard.
//           The Siege Ladder, a pad on the upper ramp: a Rocket that lands on it (struck at
//           about 100 mph) is thrown up over the lip. And the Powder Trail, a speed strip on
//           the floor fairway, runs a topped ball on to the foot of the ramp.
const keepRocket = L.flight(height, TEE, PIN, { speedMph: 125, vla: 13, spin: 2600, ball: 'rocket' });
const gadgets = [
  L.gadget('zone', 'courtyard-x3', 0, 336, { radius: 12, mult: 3 }),
  L.gadget('warp', 'great-bombard', 0, 184, { radius: 8, pair: 'bombard-muzzle', style: 'cannon', delay: 0.9 }),
  L.gadget('warp-exit', 'bombard-muzzle', 0, 186, { alt: 3, heading: 0, angle: 48, speedMph: 125, style: 'cannon' }),
  L.gadget('pad', 'siege-ladder', 0, 258, { radius: 8, heading: 0, angle: 58, minMps: 27, maxMps: 27 }),
  L.gadget('strip', 'powder-trail', 0, 56, { size: [30, 34], heading: 0, strength: 8, maxMps: 18 }),
  keepRocket.coins('keep-coins', 80, 320, 7),
];

module.exports = {
  id: 'sky-fortress',
  stage: {
    number: 10, role: 'match', order: 10,
    name: 'Sky Fortress', theme: 'canyon',
    origin: { lat: 35.4, lon: -147.0 },          // open North Pacific
    conditions: 'breezy',
    wind: { min: 8, max: 18 },                   // an exposed butte; a 125 mph Rocket still makes the lip into 18 mph
    baseM: 1400,
    timeOfDay: 'golden',
    blurb: 'Rocket par 3: from the canyon floor to a fortress green 50 m up a butte in a lake.',
    difficulty: 3,
    freeBall: 'rocket',
  },
  extent: { minX: -300, minY: -116, maxX: 300, maxY: 626 },
  hole: {
    par: 3,
    name: 'Sky Fortress',
    line: [TEE, PIN],
    note: 'A rocket par 3: 427 yards and 50 metres up to the fortress on the butte. The free Rocket ball makes the courtyard from about 118 mph; anything less lands on the Siege Ramp and is pitched on up it. The lake is all round: a stroke, dropped where the ball last crossed land.',
    greenNote: 'In the courtyard, tilted gently to the front. Sand left, right and long; the keep behind stops a big one.',
    routes: [
      { id: 'safe', name: 'The Siege Ramp', note: 'Up the scree a pitch at a time, by the Rampart ledge half way. Nothing to carry, nowhere to fall.' },
      { id: 'risky', name: 'The Bastions', note: 'Miss the top left or right and a bastion 12 m down still holds: one pitch up the bank. Wider is wet.' },
      { id: 'rocket', name: 'Storm the Keep', note: 'The free Rocket straight at the flag: 315 yards of carry, 50 m up, into the courtyard.' },
    ],
  },
  surfaces: [
    { kind: 'tee', poly: tee },
    ...fairways.map((poly) => ({ kind: 'fairway', poly })),
    { kind: 'green', poly: green },
    ...bunkers.map((poly) => ({ kind: 'bunker', poly })),
    { kind: 'water', poly: lake },
  ],
  trees,
  woods,
  props,
  gadgets,
  // the canyon's rim: nothing a Rocket can do reaches it
  obLine: L.rect(-282, -100, 284, 610),
  height,
  sea: false,
  probes: [
    { at: [0, 60], kind: 'fairway', what: 'the floor fairway' },
    { at: [0, 184], kind: 'fairway', what: 'the Rampart ledge, half way up the Siege Ramp' },
    { at: [-104, 390], kind: 'fairway', what: 'the west bastion' },
    { at: [104, 390], kind: 'fairway', what: 'the east bastion' },
    { at: [0, 330], kind: 'fairway', what: 'the courtyard' },
    { at: [0, 369], kind: 'fairway', what: 'the apron in front of the green' },
    { at: [-33, 388], kind: 'bunker', what: 'the bunker left of the green' },
    { at: [33, 396], kind: 'bunker', what: 'the bunker right of the green' },
    { at: [2, 426], kind: 'bunker', what: 'the bunker behind the green' },
    { at: [0, 124], kind: 'rough', what: 'the lower Siege Ramp' },
    { at: [0, 245], kind: 'rough', what: 'the upper Siege Ramp' },
    { at: [-74, 390], kind: 'rough', what: 'the scree between the west bastion and the top' },
    { at: [0, 474], kind: 'rough', what: 'the keep' },
    { at: [90, 40], kind: 'rough', what: 'the canyon floor right of the fairway' },
    { at: [0, 22], kind: 'rough', what: 'the foot of the launch platform' },
    { at: [-80, 200], kind: 'water', what: 'the lake left of the Siege Ramp' },
    { at: [80, 200], kind: 'water', what: 'the lake right of the Siege Ramp' },
    { at: [-160, 390], kind: 'water', what: 'the lake under the west bastion' },
    { at: [160, 390], kind: 'water', what: 'the lake under the east bastion' },
    { at: [0, 540], kind: 'water', what: 'the lake behind the keep' },
    { at: [-52, 240], kind: 'water', what: "the foot of the ramp's west wall" },
    { at: [-296, 250], kind: 'ob', what: 'over the west rim' },
    { at: [298, 250], kind: 'ob', what: 'over the east rim' },
    { at: [0, 624], kind: 'ob', what: 'over the north rim' },
  ],
};
