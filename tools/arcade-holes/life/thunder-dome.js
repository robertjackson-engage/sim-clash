'use strict';
// v3:living Thunder Dome, a sudden-death arena: the airship circles the bowl with the arena's
// name running along its flank (and flashes the callout for a great shot), four searchlights
// outside the stands rake the sky and swing to where a great one lands, shooting stars over
// the roof. The crowd, the cannons and the fireworks are the stadium's own (PropsLayer).
module.exports = [
  { kind: 'airship', x: 0, y: 90, r: 152, lift: 96, speed: 5, sign: 'THUNDER DOME  \u2022  SUDDEN DEATH' },
  { kind: 'searchlight', id: 'sl-sw', x: -150, y: -62 },
  { kind: 'searchlight', id: 'sl-se', x: 150, y: -62 },
  { kind: 'searchlight', id: 'sl-nw', x: -142, y: 252 },
  { kind: 'searchlight', id: 'sl-ne', x: 142, y: 252 },
  { kind: 'shooting-stars', everyS: 13 },
  { kind: 'balloon', path: [[-170, -100], [-152, 280]], lift: 120, speed: 1.2 },
  { kind: 'signature', x: 0, y: 226, lift: 62 },
];
