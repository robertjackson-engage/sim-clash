'use strict';
// v3:living Volcano Drop: the dragon on the Jaws watches every ball go by. Two cones smoke on
// the horizon and throw lava bombs, the lake spits, ash drifts, bats turn over the west wall.
module.exports = [
  { kind: 'dragon', x: 19, y: 88, fireEveryS: 38 },
  { kind: 'volcano', id: 'north-west', x: -330, y: 760, z: 142, scale: 4, everyS: 24 },
  { kind: 'volcano', id: 'north-east', x: 470, y: 600, z: 124, scale: 3.6, everyS: 31 },
  { kind: 'geyser', id: 'spit-west', x: -98, y: 196, glow: true, heightM: 9, everyS: 11 },
  { kind: 'geyser', id: 'spit-east', x: 80, y: 60, glow: true, heightM: 7, everyS: 16 },
  { kind: 'weather', type: 'ash' },
  { kind: 'flock', species: 'bat', x: -96, y: 118, r: 24, lift: 30, count: 9, speed: 9 },
  { kind: 'airship', x: 0, y: 175, r: 215, lift: 110, speed: -4.5, sign: 'VOLCANO DROP' },
  { kind: 'windsock', x: -14, y: -3 },
];
