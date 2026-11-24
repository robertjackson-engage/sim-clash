'use strict';
// v3:living Sky Fortress: boats on the lake under the butte, fish rising, mist where the
// falls land, eagles round the keep (the flares go up from it), a balloon down the west
// wall, an airship round the fortress, the windmill by the launch pad in the hole's wind.
module.exports = [
  { kind: 'boat', id: 'west', path: [[-222, 150], [-204, 330], [-226, 520]], count: 2, speed: 2.4, heightM: 7 },
  { kind: 'boat', id: 'east', path: [[216, 520], [206, 300], [226, 140]], count: 1, speed: 2.1, heightM: 7 },
  { kind: 'fish', id: 'fish-west', x: -152, y: 240, r: 20, count: 3, everyS: 9 },
  { kind: 'fish', id: 'fish-east', x: 162, y: 330, r: 18, count: 2, everyS: 12 },
  { kind: 'mist', id: 'east-fall', x: 150, y: 390, widthM: 14 },
  { kind: 'mist', id: 'west-fall', x: -150, y: 390, widthM: 14 },
  { kind: 'flock', species: 'crow', x: 0, y: 474, r: 40, lift: 70, count: 7, speed: 6 },
  { kind: 'balloon', path: [[-262, 60], [-250, 560]], lift: 100, speed: 1.3 },
  { kind: 'airship', x: 0, y: 400, r: 205, lift: 150, speed: 5, sign: 'SKY FORTRESS' },
  { kind: 'windmill', x: 84, y: -48, heightM: 16 },
  { kind: 'signature', x: 0, y: 474, lift: 54 },
  { kind: 'windsock', x: -22, y: 26, scale: 1 },
  { kind: 'pennants', path: [[-22, 410], [-22, 428]] },
];
