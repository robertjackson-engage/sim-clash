'use strict';
// v3:living Sakura Garden: koi turning in both ponds, mist where the Great Falls land,
// butterflies on the moss, swifts round the pagoda and on the torii, visitors strolling
// the west garden, fireflies when the light goes. (The blossom on the air is the trees' own.)
module.exports = [
  { kind: 'koi', id: 'koi-pond', x: 23, y: 106, r: 6, count: 7 },
  { kind: 'koi', id: 'south-pond', x: 44, y: 56, r: 6, count: 5 },
  { kind: 'mist', x: -1, y: 153, widthM: 16 },
  { kind: 'butterflies', x: -32, y: 60, r: 12, count: 14 },
  { kind: 'fireflies', x: -30, y: 92, r: 14, count: 30 },
  { kind: 'flock', species: 'swift', x: 46, y: 166, r: 14, lift: 36, count: 7, speed: 8 },
  { kind: 'perch', species: 'swift', at: [[-5, 181], [1, 181]], lift: 11 },
  { kind: 'walkers', path: [[-70, 30], [-80, 90], [-60, 140]], count: 6, speed: 0.9 },
  { kind: 'windmill', x: 150, y: 90, heightM: 14 },
  { kind: 'pennants', path: [[13, -6], [18, 5]], colors: ['#ff7ab0', '#f4f1e8', '#ffd21f'] },
];
