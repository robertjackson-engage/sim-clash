'use strict';
// v3:living Canyon Run: the golden hour in the canyon. Vultures turn over the gorge and sit
// on the ruins, the windmill answers the wind, a balloon drifts down the west rim, walkers
// take the trail along it, a tumbleweed crosses for a duffed one.
module.exports = [
  { kind: 'windmill', x: -34, y: 304, heightM: 20 },
  { kind: 'flock', species: 'crow', x: -70, y: 130, r: 34, lift: 62, count: 7, speed: 6 },
  { kind: 'perch', species: 'crow', at: [[-88, 150], [-96, 208], [-124, 118]], lift: 9.5 },
  { kind: 'balloon', path: [[-164, -70], [-150, 380]], lift: 92, speed: 1.3 },
  { kind: 'walkers', path: [[-118, 40], [-112, 150], [-96, 250]], count: 7 },
  { kind: 'butterflies', x: -30, y: 20, r: 8, count: 8 },
  { kind: 'windsock', x: -22, y: 26, scale: 1 },
  { kind: 'pennants', path: [[58, 276], [66, 284]] },
];
