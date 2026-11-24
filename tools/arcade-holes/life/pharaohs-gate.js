'use strict';
// v3:living Pharaoh's Gate: a camel caravan on the western dunes, sand on the wind, vultures
// high over the oasis, fish in it, a balloon down the east side, an airship round the valley,
// pilgrims on the road past the oasis, a tumbleweed for a duffed one.
module.exports = [
  { kind: 'caravan', path: [[-244, 40], [-204, 130], [-232, 230], [-184, 300]], count: 6, speed: 0.9 },
  { kind: 'weather', type: 'sand' },
  { kind: 'flock', species: 'crow', x: 196, y: 200, r: 30, lift: 62, count: 6, speed: 6 },
  { kind: 'fish', x: 122, y: 204, r: 13, count: 2, everyS: 12 },
  { kind: 'balloon', path: [[244, -80], [206, 420]], lift: 95, speed: 1.3 },
  { kind: 'airship', x: 16, y: 250, r: 225, lift: 125, speed: 4.5, sign: "PHARAOH'S GATE" },
  { kind: 'walkers', path: [[150, 40], [170, 120], [160, 250]], count: 7 },
  { kind: 'windsock', x: -23, y: 26, scale: 1 },
  { kind: 'pennants', path: [[48, 277], [58, 270]], colors: ['#ffd21f', '#f4f1e8', '#1f8a8a'] },
];
