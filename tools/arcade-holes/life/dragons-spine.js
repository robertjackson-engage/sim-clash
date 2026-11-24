'use strict';
// v3:living Dragon's Spine: the dragon on the rim follows the Rocket up onto the Spine and
// roars for a great one. The summit cone behind it smokes and throws lava bombs (it erupts
// when a Rocket leaves the tee), a far cone answers, the lava field spits, ash falls, bats
// turn over the Ash Terrace.
module.exports = [
  { kind: 'dragon', x: -83, y: 604, fireEveryS: 40 },
  { kind: 'volcano', id: 'summit', x: 44, y: 800, lift: 3, scale: 4, everyS: 23 },
  { kind: 'volcano', id: 'far-west', x: -520, y: 900, z: 272, scale: 5, everyS: 34 },
  { kind: 'geyser', id: 'spit-a', x: -150, y: 300, glow: true, heightM: 10, everyS: 12 },
  { kind: 'geyser', id: 'spit-b', x: -200, y: 120, glow: true, heightM: 8, everyS: 17 },
  { kind: 'weather', type: 'ash' },
  { kind: 'flock', species: 'bat', x: 122, y: 282, r: 30, lift: 26, count: 9, speed: 9 },
  { kind: 'airship', x: 60, y: 300, r: 245, lift: 115, speed: 4.5, sign: "DRAGON'S SPINE" },
  { kind: 'windsock', x: -16, y: 12, scale: 1 },
  { kind: 'pennants', path: [[26, 567], [35, 556]], colors: ['#ff5a14', '#ffd21f', '#f4f1e8'] },
];
