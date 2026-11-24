'use strict';
// v3:living Summit Express: the Summit Express itself, a cable car from base camp to the top
// up the east face; light snow, a groomer on the meadow, skaters on the frozen lake, choughs
// over the west arete, a balloon up the valley. Snowmen lose their heads to a ball.
module.exports = [
  { kind: 'cable-car', path: [[92, -40], [150, 180], [172, 400], [124, 640]], lift: 20, count: 5, speed: 3.6 },
  { kind: 'weather', type: 'snow' },
  { kind: 'groomer', path: [[-62, 112], [-92, 196], [-72, 258]] },
  { kind: 'walkers', id: 'skaters', path: [[-126, 40], [-96, 60], [-110, 94], [-136, 70]], loop: 'ring', count: 5, speed: 3.2 },
  { kind: 'flock', species: 'crow', x: -152, y: 300, r: 30, lift: 40, count: 8 },
  { kind: 'balloon', path: [[-222, -40], [-200, 500]], lift: 112, speed: 1.3 },
  { kind: 'windsock', x: -22, y: 26, scale: 1 },
  { kind: 'pennants', path: [[-14, 660], [-4, 667]], colors: ['#e23a2e', '#f4f1e8', '#2e6fd0'] },
];
