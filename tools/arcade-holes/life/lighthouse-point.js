'use strict';
// v3:living Lighthouse Point: a links in a sea wind. The light sweeps, both windmills turn as
// hard as the hole's wind blows, a rain squall walks along the horizon, boats beat up the
// coast, dolphins and a whale offshore, gulls over the cove and on the harbour, walkers on the
// cliff path inland.
module.exports = [
  { kind: 'beam', x: -128, y: 290, lift: 23, lengthM: 280, periodS: 10 },
  { kind: 'signature', x: -128, y: 290, lift: 34 },
  { kind: 'windmill', x: 96, y: 44, heightM: 22 },
  { kind: 'windmill', id: 'windmill-north', x: 84, y: 360, heightM: 20 },
  { kind: 'squall', path: [[-900, -260], [-860, 700]], z: 0, speed: 3 },
  { kind: 'boat', path: [[-322, -90], [-292, 120], [-318, 310]], z: 0, count: 2, speed: 2.8, heightM: 9 },
  { kind: 'dolphins', path: [[-226, 40], [-246, 130], [-236, 210]], z: 0, count: 3 },
  { kind: 'whale', x: -390, y: 190, z: 0, everyS: 40, scale: 2.6 },
  { kind: 'flock', species: 'gull', x: -236, y: 150, r: 30, lift: 30, count: 10 },
  { kind: 'flock', id: 'crows', species: 'crow', x: 100, y: 210, r: 26, lift: 30, count: 7 },
  { kind: 'perch', species: 'gull', at: [[-66, -24], [-70, 2], [-62, -30], [-74, 16]], lift: 3 },
  { kind: 'walkers', path: [[100, 30], [104, 150], [70, 280], [40, 330]], count: 8 },
  { kind: 'windsock', x: -22, y: 26, scale: 1 },
  { kind: 'pennants', path: [[-134, 284], [-122, 290]] },
];
