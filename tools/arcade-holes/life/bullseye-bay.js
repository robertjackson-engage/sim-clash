'use strict';
// v3:living Bullseye Bay, a sudden-death arena: the lighthouse on the horn sweeps the caldera
// an airship circles the rim with the arena's name on
// its flank, a boat works the west bay, dolphins play in the mouth, a whale blows beyond it.
module.exports = [
  { kind: 'beam', x: 111.5, y: 231.6, lift: 28, lengthM: 300, periodS: 11 },
  { kind: 'airship', x: 0, y: 110, r: 185, lift: 120, speed: 5, sign: 'BULLSEYE BAY  \u2022  SUDDEN DEATH' },
  { kind: 'boat', id: 'bay', path: [[84, 50], [96, 104], [80, 180]], loop: 'pingpong', z: 0, count: 1, speed: 1.8, heightM: 6 },
  { kind: 'boat', id: 'mouth', path: [[-104, 340], [0, 348], [104, 340]], z: 0, count: 1, speed: 2.6, heightM: 9 },
  { kind: 'dolphins', path: [[-70, 292], [0, 300], [70, 292]], z: 0, count: 3 },
  { kind: 'whale', x: 24, y: 372, z: 0, everyS: 34 },
  { kind: 'fish', id: 'west', x: -58, y: 104, r: 10, count: 2, everyS: 10 },
  { kind: 'fish', id: 'east', x: 58, y: 100, r: 9, count: 2, everyS: 12 },
  { kind: 'flock', species: 'gull', x: 111, y: 232, r: 22, lift: 42, count: 8 },
  { kind: 'flock', id: 'parrots', species: 'parrot', x: -150, y: 84, r: 22, lift: 24, count: 7 },
  { kind: 'turtle', x: 25, y: 97, rotDeg: 100 },
  { kind: 'windsock', x: -14, y: -3 },
];
