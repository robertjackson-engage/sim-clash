// The edit: which stretch of which raw clip goes where, the captions, the loop, the
// thumbnails. build.mjs renders it. Times are marks left by scenes.mjs plus or minus seconds
// ('drive+3.6': 3.6 s after the drive was struck; 'banner~PUTT IN TO WIN+0.8': 0.8 s after the
// turn banner with that text came up), so a re-shoot cuts in the same places.
//
// Every caption is checked against docs/arcade-v2.md and lib/launch-monitors.json:
//   TWO PLAYERS. ONE BAY. REAL SWINGS.   the game's own lobby line ("1 V 1 · REAL SWINGS · ONE BAY")
//   15 POWER-UP BALLS.                   the Balls table: 15 balls (and 3 tricks, not counted here)
//   12 HOLES. 3 SUDDEN-DEATH ARENAS.     12 stages on the tour, 3 arenas
//   FREE. OPEN SOURCE.                   MIT, as the title screen says
// The end card says what was really tested (one Foresight GCQuad) and that the swings in
// the video were scripted. No other game is named anywhere.

const cap = (id, html, y = 742, cls = '') => ({ id, width: 1920, height: 1080, html: `<div class="cap ${cls}" style="top:${y}px"><div><span>${html}</span></div></div>` });
const WM = '<span class="wm"><b class="p1">SIM</b><i></i><b class="p2">CLASH</b></span>';

export const cardText = {
  'cap-two': 'TWO PLAYERS. ONE BAY. REAL SWINGS.',
  'cap-two-low': 'TWO PLAYERS. ONE BAY. REAL SWINGS.',
  'cap-balls': '15 POWER-UP BALLS.',
  'cap-holes': '12 HOLES. 3 SUDDEN-DEATH ARENAS.',
  'cap-free': 'FREE. OPEN SOURCE.',
  'thumb-main': 'REAL BALLS. ARCADE GOLF.',
  'thumb-two': 'TWO PLAYERS. ONE BAY.',
  'thumb-wm': 'SIM CLASH',
  'thumb-free': 'FREE ARCADE GOLF FOR YOUR SIM',
};

export const cards = [
  cap('cap-two', '<b class="p1">TWO PLAYERS.</b> ONE BAY. <b class="p2">REAL SWINGS.</b>', 150),
  cap('cap-two-low', '<b class="p1">TWO PLAYERS.</b> ONE BAY. <b class="p2">REAL SWINGS.</b>', 838),
  cap('cap-balls', '<b class="gold">15</b> POWER-UP BALLS.'),
  cap('cap-holes', '<b class="p1">12 HOLES.</b> <b class="p2">3 SUDDEN-DEATH ARENAS.</b>'),
  cap('cap-free', '<b class="gold">FREE.</b> OPEN SOURCE.'),
  {
    id: 'end', width: 1920, height: 1080, html: `<div class="end">${WM}
      <div class="tag">Free and open source</div>
      <div class="url"><span>github.com/robertjackson-engage/sim-clash</span></div>
      <div class="built">Built on Open-Birdie by Rooj Rin and jordan-shilts</div>
      <div class="fine">Windows · beta · tested on one Foresight GCQuad; other launch monitors are listed as expected or community, untested<br>Gameplay capture. The swings in this video were sent by a script through the game's launch-monitor port.</div></div>`,
  },
  { id: 'thumb-main', width: 1920, height: 1080, html: '<div class="thumb-shade"></div><div class="thumb"><div>REAL BALLS.</div><div class="gold">ARCADE GOLF.</div></div>' },
  { id: 'thumb-two', width: 1920, height: 1080, html: '<div class="thumb-shade"></div><div class="thumb mid"><div class="p1">TWO PLAYERS.</div><div class="p2">ONE BAY.</div></div>' },
  { id: 'thumb-wm', width: 1920, height: 1080, html: `<div class="thumb-wm">${WM}</div>` },
  { id: 'thumb-free', width: 1920, height: 1080, html: `<div class="thumb-shade"></div><div class="thumb-wm">${WM}</div><div class="thumb mid"><div>FREE ARCADE GOLF</div><div class="gold">FOR YOUR SIM.</div></div>` },
  {
    id: 'vertical', width: 1080, height: 1920, html: `<div class="v-top">${WM}<div class="tag">Arcade 1v1 golf for real launch monitors</div></div>
      <div class="v-bot"><div class="tag">Free and open source</div><div class="url">github.com/robertjackson-engage/sim-clash</div></div>`,
  },
];

// ---------- the 60 to 90 second trailer ----------
const worlds = [
  { clip: 'world-frostbite-ridge', from: 'tee-0.12', to: 'tee+1.4', tail: 0.4, note: 'Frostbite Ridge (snow): the strike, ball cam' },
  { clip: 'world-sakura-garden', from: 'tee-0.12', to: 'tee+1.4', tail: 0.4, note: 'Sakura Garden (cherry blossom): the strike, ball cam' },
  { clip: 'world-pharaohs-gate', from: 'tee-0.12', to: 'tee+1.4', tail: 0.4, note: "Pharaoh's Gate (pyramids): the strike, ball cam" },
  { clip: 'world-midnight-mile', from: 'tee-0.12', to: 'tee+1.5', tail: 0.4, note: 'Midnight Mile (neon city): the strike, ball cam' },
  { clip: 'world-temple-run', from: 'tee-0.12', to: 'tee+1.4', tail: 0.4, note: 'Temple Run (jungle): the strike, ball cam' },
];

export const timelines = {
  trailer: {
    crf: 20,
    segments: [
      { id: 'open', clip: 'rocket', from: 'rocket-1-0.25', to: 'rocket-1+2.1', tail: 0.4, note: 'cold open: Sky Fortress, the free Rocket leaves the tee, BLAST OFF!' },
      { id: 'open-castle', clip: 'rocket', from: 'rocket-1+5.7', to: 'rocket-1+8.1', tail: 0.3, note: '... 427 yards up to the fortress, the crowd rising' },
      { id: 'open-call', clip: 'rocket', from: 'rocket-1+13.3', to: 'rocket-1+15.3', lead: 0.7, tail: 1.4, note: 'PERFECT SHOT!' },
      { id: 'title', clip: 'match', from: 'menu-2.0', to: 'menu+0.12', tail: 0.6, note: 'the title screen and the wordmark, any key' },
      { id: 'menu', clip: 'match', from: 'lobby-1.1', to: 'lobby-0.15', tail: 0.2, note: 'main menu: VERSUS' },
      { id: 'lobby', clip: 'match', from: 'start-1.6', to: 'start-0.02', tail: 0.4, note: 'the match lobby: Alex v Sam, pick Canyon Run, START' },
      { id: 'vs', clip: 'match', from: 'start+0.2', to: 'start+4.25', note: 'the VS screen slams, the coin flip' },
      { id: 'stage', clip: 'match', from: 'start+4.95', to: 'start+7.5', note: 'stage intro: Canyon Run, the wind, the three routes' },
      { id: 'drive', clip: 'match', from: 'drive-0.35', to: 'drive+1.7', tail: 0.4, note: 'the drive in ball cam (168 mph)' },
      { id: 'drive-gorge', clip: 'match', from: 'drive+3.5', to: 'drive+6.1', tail: 0.3, note: '... over the gorge, the crowd rising' },
      { id: 'drive-lands', clip: 'match', from: 'drive+7.0', to: 'drive+8.0', tail: 0.5, note: 'it lands on the green' },
      { id: 'bomb', tail: 1.6, clip: 'match', from: 'drive+10.1', to: 'drive+12.3', note: 'ABSOLUTE BOMB!' },
      { id: 'slice', clip: 'match', from: 'slice-0.3', to: 'slice+1.5', note: 'the other player slices it off the same tee' },
      { id: 'slice-house', tail: 1.6, clip: 'match', from: 'slice+9.5', to: 'slice+11.8', note: 'SLICE HOUSE!' },
      { id: 'arm', clip: 'match', from: 'arm:sticky-0.4', to: 'arm:sticky+1.8', note: 'arming the Sticky ball from the dock: the ball on the grass changes' },
      { id: 'approach', clip: 'match', from: 'approach-foil-0.15', to: 'approach-foil+0.95', note: 'the approach with it' },
      { id: 'sticks', clip: 'match', from: 'approach-foil+2.9', to: 'approach-foil+4.6', note: 'it lands and stops: GREAT SHOT!' },
      { id: 'dragon-intro', clip: 'dragon', from: 'start+5.45', to: 'start+7.7', note: "stage intro: Dragon's Spine, ROCKET HOLE, 604 yd" },
      { id: 'dragon-launch', clip: 'dragon', from: 'rocket-1-0.3', to: 'rocket-1+1.9', tail: 0.4, note: 'the rocket tee shot over the lava, ball cam' },
      { id: 'dragon-down', clip: 'dragon', from: 'rocket-1+4.9', to: 'rocket-1+7.4', tail: 0.3, note: '... 600 yards, down toward the green, the crowd rising' },
      { id: 'dragon-call', clip: 'dragon', from: 'rocket-1+13.6', to: 'rocket-1+15.9', lead: 0.6, tail: 1.4, note: 'ON THE DANCE FLOOR!' },
      { id: 'putt-banner', clip: 'match', from: 'banner~PUTT IN TO WIN+0.9', to: 'banner~PUTT IN TO WIN+2.8', note: 'the turn banner: PUTT IN TO WIN' },
      { id: 'putt', clip: 'match', from: 'putt-hero-0.2', to: 'putt-hero+0.8', note: 'the putt, 18 feet for eagle' },
      { id: 'drop', tail: 1.6, clip: 'match', from: 'putt-hero+3.3', to: 'putt-hero+8.2', note: 'slow motion by the pin, the crowd rises, it drops: DRAINED IT!' },
      { id: 'ko', tail: 1.6, clip: 'match', from: 'putt-hero+9.0', to: 'winner-0.1', note: 'KNOCKOUT! and the FOR THE WIN! stamp' },
      ...worlds.map((w, i) => ({ id: `world-${i}`, ...w })),
      { id: 'melted', tail: 1.4, clip: 'volcano', from: 'lava+6.9', to: 'lava+9.7', note: 'Volcano Drop: short of the island, into the lava, MELTED!' },
      { id: 'square', clip: 'sudden', from: 'sudden-1.4', to: 'sudden-0.1', note: 'a tied hole: ALL SQUARE! Sudden death decides it' },
      { id: 'sudden', clip: 'sudden', from: 'sudden+0.9', to: 'sudden+4.2', note: 'SUDDEN DEATH, closest to the pin, in the stadium (Thunder Dome)' },
      { id: 'sd-1', clip: 'sudden', from: 'sd-1+4.6', to: 'sd-1+7.2', note: 'first ball: on the green, 15.1 ft' },
      { id: 'sd-beat', clip: 'sudden', from: 'banner~BEAT+0.6', to: 'banner~BEAT+2.1', note: 'the turn banner: BEAT 15.1 FT' },
      { id: 'sd-2', clip: 'sudden', from: 'sd-2+6.0', to: 'sd-2+10.5', note: 'second ball: slow motion past the cup, PIN SEEKER!' },
      { id: 'sd-verdict', tail: 1.6, clip: 'sudden', from: 'sd-2+10.9', to: 'sd-2+12.6', note: 'CLOSEST TO THE PIN: 1.7 ft takes it' },
      { id: 'winner', tail: 0, clip: 'sudden', from: 'winner+0.1', to: 'winner+3.7', note: 'the winner screen, the awards, the confetti' },
      { id: 'end', card: 'end', dur: 4.6, fadeIn: 0.25, sound: { clip: 'sudden', from: 'winner+3.7' }, joinSound: true, note: 'end card (the crowd and the fanfare run on under it)' },
    ],
    captions: [
      { card: 'cap-two', on: 'vs', offset: 1.0, early: 0.15 },
      { card: 'cap-balls', on: 'arm', offset: 0.25, until: 'approach' },
      { card: 'cap-holes', on: 'world-0', offset: 0.2, until: 'world-3' },
      { card: 'cap-free', on: 'sd-1', offset: 0.15 },
    ],
    fadeOut: 0.5,
  },

  // ---------- the 20 to 30 second cut ----------
  short: {
    crf: 20,
    segments: [
      { id: 'open', clip: 'rocket', from: 'rocket-1-0.2', to: 'rocket-1+2.05', tail: 0.4, note: 'cold open: the free Rocket leaves the tee, BLAST OFF!' },
      { id: 'title', clip: 'match', from: 'menu-2.1', to: 'menu-0.02', tail: 0.7, note: 'the title screen and the wordmark' },
      { id: 'vs', clip: 'match', from: 'start+0.25', to: 'start+2.05', note: 'the VS screen slams' },
      { id: 'drive', clip: 'match', from: 'drive-0.3', to: 'drive+1.7', tail: 0.4, note: 'the drive in ball cam' },
      { id: 'bomb', tail: 1.4, clip: 'match', from: 'drive+10.1', to: 'drive+11.6', note: 'ABSOLUTE BOMB!' },
      { id: 'slice-house', tail: 1.4, clip: 'match', from: 'slice+9.5', to: 'slice+11.4', note: 'SLICE HOUSE!' },
      { id: 'dragon-launch', clip: 'dragon', from: 'rocket-1-0.25', to: 'rocket-1+2.0', tail: 0.4, note: "Dragon's Spine: the rocket tee shot over the lava" },
      { id: 'putt-banner', clip: 'match', from: 'banner~PUTT IN TO WIN+0.9', to: 'banner~PUTT IN TO WIN+2.3', note: 'PUTT IN TO WIN' },
      { id: 'drop', tail: 1.4, clip: 'match', from: 'putt-hero+4.3', to: 'putt-hero+7.9', note: 'slow motion, it drops: DRAINED IT!' },
      { id: 'ko', tail: 1.4, clip: 'match', from: 'putt-hero+9.0', to: 'winner-0.1', note: 'KNOCKOUT!' },
      { id: 'world-0', clip: 'world-midnight-mile', from: 'tee-0.1', to: 'tee+0.95', tail: 0.3, note: 'Midnight Mile: the strike' },
      { id: 'world-1', clip: 'world-sakura-garden', from: 'tee-0.1', to: 'tee+0.95', tail: 0.3, note: 'Sakura Garden: the strike' },
      { id: 'world-2', clip: 'world-pharaohs-gate', from: 'tee-0.1', to: 'tee+0.95', tail: 0.3, note: "Pharaoh's Gate: the strike" },
      { id: 'winner', tail: 0, clip: 'match', from: 'winner+0.1', to: 'winner+2.3', note: 'the winner screen' },
      { id: 'end', card: 'end', dur: 3.3, fadeIn: 0.2, sound: { clip: 'match', from: 'winner+2.3' }, joinSound: true, note: 'end card' },
    ],
    captions: [
      { card: 'cap-two-low', on: 'title', offset: 0.3, dur: 2.9 },
      { card: 'cap-holes', on: 'world-0', offset: 0.1, until: 'world-2' },
      { card: 'cap-free', on: 'dragon-launch', offset: 0.2 },
    ],
    fadeOut: 0.4,
  },
};

// ---------- the silent loop for the site and the README ----------
export const loop = { clip: 'dragon', from: 'rocket-1+0.9', to: 'rocket-1+8.9', cross: 0.6 };

// ---------- thumbnails (1280 x 720) ----------
export const thumbnails = [
  { id: 'main', file: 'thumbnail.jpg', clip: 'dragon', at: 'rocket-1+1.75', zoom: 1.5, zx: 0.25, zy: 0.55, card: 'thumb-main' },
  { id: 'alt-1', file: 'thumbnail-alt-1-two-players.jpg', clip: 'match', at: 'start+1.55', card: 'thumb-two' },
  { id: 'alt-2', file: 'thumbnail-alt-2-slice-house.jpg', clip: 'match', at: 'slice+10.6', zoom: 1.45, zx: 0.2, zy: 0.42, card: 'thumb-wm' },
  { id: 'alt-3', file: 'thumbnail-alt-3-stadium.jpg', clip: 'sudden', at: 'sd-2+3.9', zoom: 1.4, zx: 0.12, zy: 0.5, card: 'thumb-free' },
];
