'use strict';
// v3:living Lagoon Island: a harbour morning. Boats working the outer lagoon, dolphins off
// the reef, fish in the lagoon either side of the line, a turtle on the bar, gulls on the
// harbour posts (they laugh at a bad one), parrots over the palms.
// The hole's own coordinates (the tee is the origin, x east, y north); the sea is z = 0.
module.exports = [
  { kind: 'boat', id: 'outer', path: [[-215, 40], [-175, 150], [-150, 250], [-60, 312]], z: 0, count: 2, speed: 2.6, heightM: 7 },
  { kind: 'dolphins', path: [[-190, 300], [-60, 322], [80, 318]], z: 0, count: 3 },
  { kind: 'fish', id: 'lagoon-west', x: -62, y: 84, r: 16, count: 3, everyS: 9 },
  { kind: 'fish', id: 'lagoon-east', x: 104, y: 112, r: 14, count: 2, everyS: 11 },
  { kind: 'turtle', x: 62, y: 96, rotDeg: 250 },
  { kind: 'perch', species: 'gull', at: [[96, 14], [104, 2], [110, 26], [90, 44]], lift: 3.2 },
  { kind: 'flock', id: 'parrots', species: 'parrot', x: 160, y: 130, r: 24, lift: 26, count: 8 },
  { kind: 'flock', id: 'gulls', species: 'gull', x: -170, y: 210, r: 30, lift: 30, count: 9 },
  { kind: 'butterflies', x: 26, y: 12, r: 9, count: 10 },
  { kind: 'balloon', path: [[-210, 100], [-150, 320]], lift: 85, speed: 1.4 },
  { kind: 'windsock', x: -17, y: 14, scale: 1 },
  { kind: 'pennants', path: [[-43, 151], [-35, 161]] },
];
