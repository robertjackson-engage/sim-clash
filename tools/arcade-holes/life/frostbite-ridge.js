'use strict';
// v3:living Frostbite Ridge: light snow, a cable car up the east face, a groomer working the
// slope under the ridge, skaters on the lake's far side, choughs over the summit, the windmill
// in the valley. A ball through a snowman takes its head off (every snowman on the stage).
module.exports = [
  { kind: 'weather', type: 'snow' },
  { kind: 'cable-car', path: [[236, 40], [252, 200], [242, 360]], lift: 18, count: 4 },
  { kind: 'groomer', path: [[-62, 60], [-72, 140], [-44, 222]] },
  { kind: 'walkers', id: 'skaters', path: [[92, 132], [112, 168], [98, 214], [84, 172]], loop: 'ring', count: 5, speed: 3.2 },
  { kind: 'flock', species: 'crow', x: -92, y: 40, r: 24, lift: 30, count: 7 },
  { kind: 'windmill', x: -224, y: 240, heightM: 15 },
  { kind: 'balloon', path: [[-262, 60], [-204, 380]], lift: 92, speed: 1.2 },
  { kind: 'windsock', x: -23, y: 26, scale: 1 },
  { kind: 'pennants', path: [[70, 318], [84, 310]], colors: ['#e23a2e', '#f4f1e8', '#2e6fd0'] },
];
