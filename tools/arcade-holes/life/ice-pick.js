'use strict';
// v3:living Ice Pick, a sudden-death arena: the ice dragon on the west shelf follows the one
// ball each player gets and roars for a great one; light snow under the aurora, a cable car
// from base camp to the castle, skaters on the far side of the
// tarn, choughs over the west crest. Snowmen lose their heads to a ball.
module.exports = [
  { kind: 'dragon', x: -106.4, y: 166.9, fireEveryS: 36 },
  { kind: 'weather', type: 'snow', amount: 0.8 },
  { kind: 'cable-car', path: [[152, 20], [142, 110], [106, 168]], lift: 14, count: 3, speed: 2.8 },
  { kind: 'walkers', id: 'skaters', path: [[46, 84], [58, 104], [50, 130], [38, 108]], loop: 'ring', count: 4, speed: 2.8 },
  { kind: 'flock', species: 'crow', x: -142, y: 60, r: 24, lift: 30, count: 7 },
  { kind: 'windsock', x: -22, y: 26, scale: 1 },
  { kind: 'pennants', path: [[-10, 132], [10, 132]], colors: ['#7fe0ff', '#f4f1e8', '#ffd21f'] },
];
