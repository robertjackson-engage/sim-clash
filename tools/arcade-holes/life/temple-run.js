'use strict';
// v3:living Temple Run: the dragon behind the temple watches the ball all the way up the
// gorge. Crocodiles lie in both rivers (a splash brings one up snapping), mist hangs under
// the falls and drifts on the floor, parrots, butterflies, fireflies in the trees.
module.exports = [
  { kind: 'dragon', x: 12, y: 590, fireEveryS: 46 },
  { kind: 'croc', id: 'first-river', x: 118, y: 314, rotDeg: 80 },
  { kind: 'croc', id: 'first-river-west', x: -150, y: 314, rotDeg: 280 },
  { kind: 'croc', id: 'second-river', x: -110, y: 407, rotDeg: 100 },
  { kind: 'mist', id: 'falls-ne', x: 198, y: 300, widthM: 12 },
  { kind: 'mist', id: 'falls-nw', x: -202, y: 302, widthM: 12 },
  { kind: 'mist', id: 'falls-w', x: -202, y: 412, widthM: 12 },
  { kind: 'mist', id: 'falls-e', x: 200, y: 418, widthM: 12 },
  { kind: 'weather', type: 'mist' },
  { kind: 'flock', species: 'parrot', x: -104, y: 150, r: 28, lift: 26, count: 8 },
  { kind: 'butterflies', x: 42, y: 84, r: 14, count: 14 },
  { kind: 'fireflies', id: 'west-wood', x: -62, y: 200, r: 20, count: 34 },
  { kind: 'fireflies', id: 'east-wood', x: 72, y: 240, r: 18, count: 28 },
  { kind: 'airship', x: 12, y: 380, r: 235, lift: 115, speed: 4.5, sign: 'TEMPLE RUN' },
  { kind: 'pennants', path: [[40, 492], [52, 500]] },
];
