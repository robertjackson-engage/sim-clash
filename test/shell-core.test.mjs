// The game product's front end, the part with no DOM in it (public/arcade/shell-core.js):
// which product a page is, where it starts, the menu's state machine (navigation, ESC, the
// swing gate), the lists the menus are built from, and the test swing. Also the product's
// name as the page reads it (public/arcade/product.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createShellMachine, pageProduct, startScreen, mainItems, soloItems, PRACTICE_GAMES, practiceGame, cueFor,
  testSwing, swingForCarry, puttForFeet, TEST_SWINGS, soloHeaderView, parWords, relText, SCREENS,
} from '../public/arcade/shell-core.js';
import { resolveProduct, wordmarkParts } from '../public/arcade/product.js';

const q = (s) => new URLSearchParams(s);
const counts = { main: 6, solo: 5, practice: 4, players: 3, settings: 10, 'solo-stage': 15, 'practice-stage': 15, pause: 5, result: 2 };
const machine = (start = 'title') => createShellMachine({ start, count: (s) => counts[s] || 0, columns: () => 5 });

test('the page is the game unless the server or the address says simulator', () => {
  assert.equal(pageProduct({ query: q(''), product: { mode: 'simclash' } }), 'simclash');
  assert.equal(pageProduct({ query: q(''), product: null }), 'simclash');
  assert.equal(pageProduct({ query: q(''), product: { mode: 'open-birdie' } }), 'open-birdie');
  assert.equal(pageProduct({ query: q('sim=1'), product: { mode: 'simclash' } }), 'open-birdie');
  assert.equal(pageProduct({ query: q('arcade=0'), product: { mode: 'simclash' } }), 'open-birdie');
  assert.equal(pageProduct({ query: q('visualCapture=1'), product: { mode: 'simclash' } }), 'open-birdie');
});

test('the page starts on the title; deep links skip it', () => {
  assert.equal(startScreen(q('')), 'title');
  assert.equal(startScreen(q('match=1')), 'versus');
  assert.equal(startScreen(q('menu=0')), 'game');
  assert.equal(startScreen(q('menu=main')), 'main');
  assert.equal(startScreen(q('connect=1')), 'connect');
  assert.deepEqual(machine('versus').stack, ['title', 'main', 'versus']);   // ESC from a deep link still steps back
  assert.deepEqual(machine('game').stack, ['game']);
});

test('title: any key asks to leave it; leaving goes to the main menu, through the wizard on a first run', () => {
  let m = machine();
  assert.equal(m.screen, 'title');
  assert.equal(m.inMenu, true);
  assert.deepEqual(m.key('a'), { type: 'leave-title' });
  assert.deepEqual(m.key('a', { repeat: true }), { type: 'none' });   // a held key does not skip it
  assert.deepEqual(m.key('F11'), { type: 'none' });                   // full screen is not "any key"
  assert.deepEqual(m.key('Shift'), { type: 'none' });
  assert.equal(m.leaveTitle().screen, 'main');
  assert.deepEqual(m.stack, ['title', 'main']);
  assert.equal(m.leaveTitle().type, 'none');                          // only from the title

  m = machine();
  assert.equal(m.leaveTitle({ needsConnect: true }).screen, 'connect');
  assert.deepEqual(m.stack, ['title', 'main', 'connect']);
  assert.equal(m.inMenu, true);                                       // the wizard's test ball is nobody's shot
  assert.deepEqual(m.key('Enter'), { type: 'none' });                 // the wizard's keys are its own
  assert.equal(m.back().screen, 'main');                              // done or skipped: the main menu is under it
});

test('main menu: arrows move and wrap, Enter selects, number keys jump, ESC steps back one level', () => {
  const m = machine('main');
  assert.equal(m.cursor(), 0);
  assert.deepEqual(m.key('ArrowDown'), { type: 'move', screen: 'main', cursor: 1 });
  assert.deepEqual(m.key('ArrowUp'), { type: 'move', screen: 'main', cursor: 0 });
  assert.deepEqual(m.key('ArrowUp'), { type: 'move', screen: 'main', cursor: 5 });   // wraps
  assert.deepEqual(m.key('ArrowDown'), { type: 'move', screen: 'main', cursor: 0 });
  assert.deepEqual(m.key('Enter'), { type: 'select', screen: 'main', index: 0 });
  assert.deepEqual(m.key('3'), { type: 'select', screen: 'main', index: 2 });
  assert.equal(m.cursor(), 2);
  assert.deepEqual(m.key('9'), { type: 'none' });                                    // no ninth item
  assert.deepEqual(m.key('Enter', { repeat: true }), { type: 'none' });

  assert.equal(m.open('solo').screen, 'solo');
  assert.equal(m.open('solo-stage').screen, 'solo-stage');
  assert.deepEqual(m.stack, ['title', 'main', 'solo', 'solo-stage']);
  assert.deepEqual(m.key('Escape'), { type: 'back', screen: 'solo', from: 'solo-stage' });
  assert.deepEqual(m.key('Escape'), { type: 'back', screen: 'main', from: 'solo' });
  assert.deepEqual(m.key('Escape'), { type: 'back', screen: 'title', from: 'main' });
  assert.deepEqual(m.key('Escape'), { type: 'leave-title' });                        // on the title every key is "any key"
  assert.equal(m.back().type, 'none');                                               // nothing behind the title
});

test('a grid moves in two dimensions; a list item takes left and right as an adjustment', () => {
  const m = machine('main');
  m.open('solo'); m.open('solo-stage');
  assert.deepEqual(m.key('ArrowRight'), { type: 'move', screen: 'solo-stage', cursor: 1 });
  assert.deepEqual(m.key('ArrowDown'), { type: 'move', screen: 'solo-stage', cursor: 6 });
  assert.deepEqual(m.key('ArrowUp'), { type: 'move', screen: 'solo-stage', cursor: 1 });
  assert.deepEqual(m.key('End'), { type: 'move', screen: 'solo-stage', cursor: 14 });
  assert.deepEqual(m.key('ArrowDown'), { type: 'none' });                            // the last row stays the last row
  assert.deepEqual(m.key('5'), { type: 'none' });                                    // numbers are for lists
  m.back(); m.back(); m.open('settings');
  m.key('ArrowDown');
  assert.deepEqual(m.key('ArrowLeft'), { type: 'adjust', screen: 'settings', index: 1, dir: -1 });
  assert.deepEqual(m.key('ArrowRight'), { type: 'adjust', screen: 'settings', index: 1, dir: 1 });
});

test('the swing gate: every screen but play itself is "in the menus"', () => {
  const m = machine();
  const gate = {};
  for (const s of Object.keys(SCREENS)) {
    m.go(s);
    gate[s] = m.inMenu;
  }
  assert.deepEqual(gate, {
    title: true, main: true, versus: true, connect: true, solo: true, 'solo-stage': true, practice: true, 'practice-stage': true,
    players: true, settings: true, monitor: true, credits: true, howto: true,
    game: false, pause: false, result: false,
  });
});

test('a real swing on the title is "press any key", and never anything else', () => {
  const m = machine();
  assert.deepEqual(m.swing(), { type: 'open', screen: 'main', from: 'title' });
  assert.equal(m.screen, 'main');
  assert.equal(m.inMenu, true);                    // still in the menus: the swing was not a shot
  assert.deepEqual(m.swing(), { type: 'none' });   // a swing in the main menu does nothing
  m.open('settings');
  assert.deepEqual(m.swing(), { type: 'none' });
  m.go('game');
  assert.deepEqual(m.swing(), { type: 'none' });   // in play the server plays it; the menu has no say
  assert.equal(m.inMenu, false);
});

test('in play: the menu leaves the keys alone; pause and the result card sit on top of the game', () => {
  const m = machine('game');
  assert.deepEqual(m.key('Escape'), { type: 'none' });   // the page decides what Esc is in play (the pause menu, the match menu)
  assert.deepEqual(m.key('1'), { type: 'none' });        // a number key arms a ball
  assert.equal(m.open('pause').screen, 'pause');
  assert.deepEqual(m.stack, ['game', 'pause']);
  assert.deepEqual(m.key('2'), { type: 'select', screen: 'pause', index: 1 });
  assert.equal(m.open('settings').screen, 'settings');   // SETTINGS from the pause menu ...
  assert.equal(m.inMenu, true);
  assert.equal(m.key('Escape').screen, 'pause');         // ... and ESC comes back to it
  assert.equal(m.key('Escape').screen, 'game');
  m.open('result');
  assert.deepEqual(m.key('Escape'), { type: 'none' });   // a result card is left by its buttons
  assert.deepEqual(m.key('Enter'), { type: 'select', screen: 'result', index: 0 });
  assert.deepEqual(m.go('main').screen, 'main');         // EXIT TO MAIN MENU
  assert.deepEqual(m.stack, ['title', 'main']);
});

test('one sound per action', () => {
  assert.equal(cueFor({ type: 'move' }), 'ui-tick');
  assert.equal(cueFor({ type: 'adjust' }), 'ui-tick');
  assert.equal(cueFor({ type: 'select' }), 'ui-confirm');
  assert.equal(cueFor({ type: 'back' }), 'ui-back');
  assert.equal(cueFor({ type: 'open', screen: 'main', from: 'title' }), 'whoosh');
  assert.equal(cueFor({ type: 'open', screen: 'versus', from: 'main' }), null);   // the lobby brings its own
  assert.equal(cueFor({ type: 'none' }), null);
  assert.equal(cueFor(null), null);
});

test('the menus: QUIT only in a window, the tour at the lengths the stages allow, the practice games that fit a stage', () => {
  assert.deepEqual(mainItems().map((x) => x.id), ['versus', 'solo', 'practice', 'players', 'settings', 'howto']);
  assert.equal(mainItems({ canQuit: true }).at(-1).id, 'quit');

  assert.deepEqual(soloItems({ stages: 12 }).map((x) => x.id), ['tour-3', 'tour-6', 'tour-12', 'single']);
  assert.deepEqual(soloItems({ stages: 5 }).map((x) => x.id), ['tour-3', 'tour-5', 'single']);
  assert.deepEqual(soloItems({ stages: 3 }).map((x) => x.id), ['tour-3', 'single']);
  assert.equal(soloItems({ stages: 0 }).at(-1).disabled, true);
  const bests = { tours: { 12: { p1: { strokes: 44, toPar: -2 } } } };
  assert.match(soloItems({ stages: 12, bests, playerId: 'p1' })[2].sub, /BEST -2 · 44 STROKES/);
  assert.match(soloItems({ stages: 12, bests, playerId: 'p2' })[2].sub, /NO SCORE YET/);

  assert.deepEqual(PRACTICE_GAMES.map((g) => g.id), ['free', 'closest', 'putting', 'chipping']);
  const closest = practiceGame('closest');
  assert.equal(closest.fits({ par: 3, lengthYd: 151 }), true);
  assert.equal(closest.fits({ par: 4, lengthYd: 357 }), false);
  assert.equal(closest.fits({ par: 3, lengthYd: 427 }), false);   // a rocket hole is no closest-to-the-pin
  assert.equal(practiceGame('putting').fits({ par: 5 }), true);
  assert.equal(practiceGame('nope').id, 'free');
});

test('the test swing: the smart swing is the shot the lineup predicts; presets are what they say', () => {
  const plan = { launch: { speedMph: 120.4, vla: 16.5, totalSpin: 5400 }, isPutt: false };
  assert.deepEqual(testSwing('auto', { lie: 'fairway', distToPinYd: 180 }, null, plan), { speed: 120.4, vla: 16.5, hla: 0, spin: 5400, spinAxis: 0 });
  const off = testSwing('auto', { lie: 'fairway', distToPinYd: 180 }, () => 1, plan);
  assert.ok(off.speed > 120.4 && off.speed < 124 && off.hla === 1.2);                     // a touch of human error, never a wild one
  const putt = testSwing('auto', { lie: 'green', distToPinYd: 4 }, null, { launch: { speedMph: 6.2, vla: 0, totalSpin: 0 }, isPutt: true });
  assert.deepEqual(putt, { speed: 6.2, vla: 0, hla: 0, spin: 0, spinAxis: 0 });
  // no plan: the table stands in
  const iron = testSwing('auto', { lie: 'fairway', distToPinYd: 150 });
  assert.ok(iron.speed > 95 && iron.speed < 112 && iron.vla > 15);
  assert.equal(testSwing('auto', { lie: 'green', distToPinYd: 5 }).vla, 0);
  assert.deepEqual(testSwing('drive'), TEST_SWINGS.find((t) => t.id === 'drive').ball);
  assert.equal(testSwing('putt', { lie: 'green', distToPinYd: 3 }).spin, 0);
  assert.ok(swingForCarry(1000).speed <= 176 && swingForCarry(-5).speed >= 22);          // clamped to the table
  assert.ok(puttForFeet(40).speed > puttForFeet(5).speed);
  assert.deepEqual(TEST_SWINGS.map((t) => t.key), ['1', '2', '3', '4', '5', '6']);
});

test('the solo header and the small words', () => {
  const run = { kind: 'tour', phase: 'play', index: 1, player: { name: 'Alex' }, totals: { played: 1, toPar: -1 },
    stages: [{ name: 'Lagoon Island', par: 3 }, { name: 'Canyon Run', par: 4, shots: 2 }] };
  assert.deepEqual(soloHeaderView(run, { strokes: 2 }), { kind: 'SOLO TOUR', step: 'STAGE 2 OF 2', stage: 'CANYON RUN', par: 4, strokes: 2, shot: 3, total: '-1', player: 'ALEX' });
  assert.equal(soloHeaderView({ ...run, kind: 'free' }, { strokes: 0 }).total, null);
  assert.equal(soloHeaderView(null), null);
  assert.equal(relText(0), 'E'); assert.equal(relText(3), '+3'); assert.equal(relText(-2), '-2');
  assert.equal(parWords(0), 'LEVEL PAR'); assert.equal(parWords(-3), '3 UNDER'); assert.equal(parWords(2), '2 OVER');
});

test('the name is one value: the wordmark is built from it', () => {
  assert.deepEqual(wordmarkParts('Sim Clash'), ['SIM', 'CLASH']);
  assert.deepEqual(wordmarkParts('Golfbash'), ['GOLFBASH', '']);
  assert.deepEqual(wordmarkParts('Bay Brawl Golf'), ['BAY', 'BRAWL GOLF']);
  const p = resolveProduct({ name: 'Bay Brawl', mode: 'simclash', version: '2.0.0', repo: { owner: 'OWNER', name: 'x' } });
  assert.equal(p.name, 'Bay Brawl');
  assert.deepEqual(p.words, ['BAY', 'BRAWL']);
  assert.equal(p.url, '');                                                      // a placeholder repository gives no link
  assert.equal(resolveProduct({ name: 'X Y', repo: { owner: 'me', name: 'xy' } }).url, 'https://github.com/me/xy');
  assert.deepEqual(resolveProduct(null).words, ['SIM', 'CLASH']);               // no bootstrap: the defaults
  assert.ok(resolveProduct(null).builtOn.some((b) => /Open-Birdie/.test(b.name)));   // the credit stays
});
