'use strict';
// v2:playability A preload that turns the arcade layer's play assists (lib/playability.js
// PLAY_ASSIST: launch clearance, soft trees, 90 degree aim, the rescue drop) ON for every
// Game a test creates, so a whole suite can be run the way the arcade plays:
//
//   NODE_OPTIONS=--require=./test/helpers/play-assist-on.cjs node --test test/arcade-holes.test.js
//
// (test/arcade-playability.test.js runs the hole suites this way: the route claims of the
// stages, walls that stop a plain drive and all, must hold with the assists on.)
// BIRDIE_TEST_CLEAR_RISE / BIRDIE_TEST_CLEAR_M: try another clearance (tuning only).
const { Game } = require('../../lib/game');
const { PLAY_ASSIST } = require('../../lib/playability');

const rise = Number(process.env.BIRDIE_TEST_CLEAR_RISE), dist = Number(process.env.BIRDIE_TEST_CLEAR_M);
Game.defaultPlayAssist = rise > 0 || dist > 0
  ? Object.freeze({ ...PLAY_ASSIST, physics: Object.freeze({ ...PLAY_ASSIST.physics, ...(rise > 0 ? { launchClearRiseM: rise } : {}), ...(dist > 0 ? { launchClearM: dist } : {}) }) })
  : PLAY_ASSIST;
