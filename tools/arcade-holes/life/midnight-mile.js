'use strict';
// v3:living Midnight Mile: the city does not sleep. An elevated train crosses the south
// end of the harbour and the boulevard, 140 m out from the tee, its windows lit (it crosses
// the line of play there, 10 m below the tee: `crossing`); cars cross the north flyover
// under their traffic lights; a gondola works the canal under the bridges and a boat the
// harbour; the harbour light sweeps;
// searchlights rake the sky over the stadium and swing to a great shot; shooting stars.
// A Rocket off the tower is chased down the harbour by fireworks.
module.exports = [
  { kind: 'train', path: [[-232, 138], [-60, 138], [56, 139]], z: 24, count: 5, speed: 15, gapS: 16, scale: 1.25, track: true, crossing: true },
  { kind: 'cars', path: [[-296, 574], [-100, 580], [60, 574], [190, 580]], lift: 12, count: 10, speed: 14, track: true },
  { kind: 'traffic-light', at: [[-200, 577], [-20, 578], [130, 577]], lift: 12 },
  { kind: 'gondola', path: [[-41, -86], [-41, 104]], loop: 'pingpong', speed: 1.5 },
  { kind: 'boat', path: [[-190, 142], [-150, 204], [-186, 274]], loop: 'pingpong', count: 1, speed: 2.2, heightM: 7 },
  { kind: 'beam', x: -216, y: 122, lift: 21, lengthM: 260, periodS: 9, color: '#bfe9ff' },
  { kind: 'searchlight', id: 'sl-1', x: -66, y: 500 },
  { kind: 'searchlight', id: 'sl-2', x: -200, y: 452 },
  { kind: 'searchlight', id: 'sl-3', x: 44, y: 300 },
  { kind: 'searchlight', id: 'sl-4', x: -244, y: 300 },
  { kind: 'shooting-stars', everyS: 12 },
  { kind: 'airship', x: -110, y: 430, r: 160, lift: 105, speed: 5, sign: 'MIDNIGHT MILE  \u2022  SIM CLASH' },
  { kind: 'flock', species: 'crow', x: 124, y: 100, r: 20, lift: 44, count: 7 },
  { kind: 'signature', x: -143, y: 513, lift: 62 },
];
