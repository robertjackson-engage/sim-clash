// The edit: which stretch of which raw clip goes where, the captions, the loop, the
// thumbnails. build.mjs renders it. Times are marks left by scenes.mjs plus or minus seconds
// ('drive+3.6': 3.6 s after the drive was struck; 'banner~PUTT IN TO WIN+0.8': 0.8 s after the
// turn banner with that text came up), so a re-shoot cuts in the same places.
//
// This is the cut of 1.0.0-beta.2: the rebuilt stages, the course gadgets, the living world,
// the new games. Every caption is checked against the release notes and the game's data:
//   NEW LOOK. EVERY STAGE REBUILT.       release notes: "every stage has been rebuilt"
//   76 GADGETS A REAL SWING CAN HIT.     the stage files: 76 (a pipe and its exit as one)
//   A LIVING WORLD.                      docs/living-world.md (here: a Rocket sets the cones off)
//   TWO PLAYERS. ONE BAY. REAL SWINGS.   the game's own lobby line
//   INSTANT REPLAYS.                     docs/modes.md: a notable shot is shown again, by itself
//   BULLSEYE. DARTS WITH A GOLF BALL.    the game's own line for the mode
//   FREE. OPEN SOURCE.                   MIT, as the title screen says
// The end card says where to get it and that the swings in the video were sent by a script.
// No other game, no company and no launch monitor is named anywhere. The site's address is
// written {{SITE}} here: build.mjs holds it (SITE_ADDRESS), in one place.

const cap = (id, html, y = 742, cls = '') => ({ id, width: 1920, height: 1080, html: `<div class="cap ${cls}" style="top:${y}px"><div><span>${html}</span></div></div>` });
const WM = '<span class="wm"><b class="p1">SIM</b><i></i><b class="p2">CLASH</b></span>';

export const cardText = {
  'cap-look': 'NEW LOOK. EVERY STAGE REBUILT.',
  'cap-gadgets': '76 GADGETS A REAL SWING CAN HIT.',
  'cap-world': 'A LIVING WORLD.',
  'cap-two': 'TWO PLAYERS. ONE BAY. REAL SWINGS.',
  'cap-replay': 'INSTANT REPLAYS.',
  'cap-bullseye': 'BULLSEYE. DARTS WITH A GOLF BALL.',
  'cap-free': 'FREE. OPEN SOURCE.',
  'thumb-main': 'REAL BALLS. ARCADE GOLF.',
  'thumb-two': 'TWO PLAYERS. ONE BAY.',
  'thumb-wm': 'SIM CLASH',
  'thumb-free': 'FREE ARCADE GOLF FOR YOUR SIM',
};

export const cards = [
  cap('cap-look', '<b class="gold">NEW LOOK.</b> EVERY STAGE REBUILT.', 838),
  cap('cap-gadgets', '<b class="gold">76 GADGETS</b> A REAL SWING CAN HIT.'),
  cap('cap-world', 'A <b class="gold">LIVING</b> WORLD.'),
  cap('cap-two', '<b class="p1">TWO PLAYERS.</b> ONE BAY. <b class="p2">REAL SWINGS.</b>', 150),
  cap('cap-replay', 'INSTANT <b class="gold">REPLAYS.</b>'),
  cap('cap-bullseye', '<b class="gold">BULLSEYE.</b> DARTS WITH A GOLF BALL.'),
  cap('cap-free', '<b class="gold">FREE.</b> OPEN SOURCE.'),
  {
    id: 'end', width: 1920, height: 1080, html: `<div class="end">${WM}
      <div class="tag">Free and open source</div>
      <div class="dl"><span>Download for Windows</span></div>
      <div class="url"><span>{{SITE}}</span></div>
      <div class="fine">1.0.0-beta.2 · Windows 10 and 11 · arcade golf for real launch monitors<br>Gameplay capture. The swings in this video were sent by a script through the game's launch-monitor port.</div></div>`,
  },
  { id: 'thumb-main', width: 1920, height: 1080, html: '<div class="thumb-shade"></div><div class="thumb"><div>REAL BALLS.</div><div class="gold">ARCADE GOLF.</div></div>' },
  { id: 'thumb-two', width: 1920, height: 1080, html: '<div class="thumb-shade"></div><div class="thumb mid"><div class="p1">TWO PLAYERS.</div><div class="p2">ONE BAY.</div></div>' },
  { id: 'thumb-wm', width: 1920, height: 1080, html: `<div class="thumb-wm">${WM}</div>` },
  { id: 'thumb-free', width: 1920, height: 1080, html: `<div class="thumb-shade"></div><div class="thumb-wm">${WM}</div><div class="thumb mid"><div>FREE ARCADE GOLF</div><div class="gold">FOR YOUR SIM.</div></div>` },
  {
    id: 'vertical', width: 1080, height: 1920, html: `<div class="v-top">${WM}<div class="tag">Arcade golf for real launch monitors</div></div>
      <div class="v-bot"><div class="tag">Free and open source</div><div class="dl">Download for Windows</div><br><div class="url">{{SITE}}</div></div>`,
  },
];

// ---------- the pieces both cuts are made of ----------
// the rebuilt stages: the game's own hole flyover (key F), the picture only. `len` seconds from `at` after F
const fly = (id, stage, at, len, note) => ({ id, clip: `fly-${stage}`, from: `fly+${at}`, to: `fly+${(at + len).toFixed(2)}`, sound: 'none', note });
// a gadget: the swing meeting it, then its callout
const rel = (mark, v) => `${mark}${v < 0 ? '' : '+'}${v}`;
const gadget = (id, clip, a, b, note, extra = {}) => ({ id, clip, from: rel('swing', a), to: rel('swing', b), tail: 0.35, note, ...extra });

// ---------- the 60 to 90 second trailer ----------
export const timelines = {
  trailer: {
    segments: [
      // cold open: the 150 mph wall
      { id: 'open', clip: 'match', from: 'drive-0.3', to: 'drive+2.75', tail: 0.4, note: 'cold open: Canyon Run, 158 mph at the flag, through the 150 MPH wall and the boost ring behind it (ball cam)' },
      { id: 'open-call', clip: 'match', from: 'drive+9.55', to: 'drive+11.9', lead: 0.3, tail: 1.3, note: 'on the green: SMASHED IT!' },
      { id: 'title', clip: 'match', from: 'menu-2.3', to: 'menu+0.1', tail: 0.6, note: 'the title screen and the wordmark (VERSION 1.0.0-BETA.2), any key' },
      { id: 'menu', clip: 'match', from: 'lobby-1.25', to: 'lobby-0.1', tail: 0.3, note: 'the main menu: VERSUS, PARTY, BULLSEYE, TRICK SHOT DUEL, SOLO, PRACTICE' },
      // the new look: the game's own flyover on seven stages
      fly('fly-dome', 'thunder-dome', 2.2, 2.15, 'Thunder Dome: the bowl, the crowd, the screens (hole flyover)'),
      fly('fly-sakura', 'sakura-garden', 0.6, 1.85, 'Sakura Garden: cherry in blossom'),
      fly('fly-temple', 'temple-run', 4.2, 1.85, 'Temple Run: the jungle'),
      fly('fly-lagoon', 'lagoon-island', 2.0, 2.05, 'Lagoon Island: the water, the sky'),
      fly('fly-volcano', 'volcano-drop', 2.1, 2.05, 'Volcano Drop: the lava'),
      fly('fly-midnight', 'midnight-mile', 2.8, 1.95, 'Midnight Mile at night: the boulevard, the train'),
      fly('fly-frost', 'frostbite-ridge', 2.5, 2.05, 'Frostbite Ridge: snow'),
      // the gadgets, each met by a swing, each with its callout
      gadget('ring-strike', 'g-ring', -0.2, 0.75, 'Frostbite Ridge: 131 mph at the boost ring over the ice'),
      gadget('ring', 'g-ring', 4.05, 5.4, '... and through it', { tail: 0.8 }),
      gadget('ring-call', 'g-ring', 10.45, 11.45, 'RING IT!', { tail: 1.0 }),
      gadget('pad', 'g-pad', 5.3, 7.75, 'Lagoon Island: short in the sand, onto the bounce pad, thrown to the green'),
      gadget('pad-call', 'g-pad', 8.35, 9.2, 'BOING!', { tail: 1.0 }),
      gadget('strip', 'g-strip', 5.9, 8.1, 'Midnight Mile: the speed strip up the Boulevard'),
      gadget('strip-call', 'g-strip', 14.5, 15.4, 'TURBO!', { tail: 1.0 }),
      gadget('bumper', 'g-bumper', 4.75, 6.55, 'Midnight Mile: long into the stadium green, off a bumper', { tail: 0.6 }),
      gadget('bumper-call', 'g-bumper', 9.95, 10.95, 'PINBALL WIZARD!', { tail: 1.0 }),
      gadget('warp', 'g-warp', 3.5, 6.15, 'Temple Run: into the serpent pipe, fired out onto the green', { tail: 0.6 }),
      gadget('warp-call', 'g-warp', 7.75, 8.65, 'WARP SPEED!', { tail: 1.0 }),
      gadget('coins', 'g-coins', 1.55, 3.85, 'Canyon Run: the coin trail over the gorge'),
      gadget('coins-call', 'g-coins', 10.55, 11.55, 'FULL TRAIL!', { tail: 1.0 }),
      // the world answers a shot
      { id: 'dragon', clip: 'dragon', from: 'rocket-1-0.2', to: 'rocket-1+3.3', tail: 0.5, note: "Dragon's Spine: the free Rocket leaves the tee, the shock ring runs out, the cones erupt (the rocket trail, ball cam)" },
      // the match
      { id: 'vs', clip: 'match', from: 'start+0.25', to: 'start+2.5', note: 'the VS screen slams' },
      { id: 'putt-banner', clip: 'match', from: 'banner~PUTT IN TO WIN+0.5', to: 'banner~PUTT IN TO WIN+2.0', note: 'the turn banner: PUTT IN TO WIN' },
      { id: 'drop', tail: 1.5, clip: 'match', from: 'putt-hero+5.9', to: 'putt-hero+10.85', note: '56 feet: slow motion by the pin, it drops, DRAINED IT!' },
      { id: 'ko', tail: 1.2, clip: 'match', from: 'winner-1.75', to: 'winner-0.08', note: 'KNOCKOUT! and the FOR THE WIN! stamp' },
      { id: 'replay', clip: 'match', from: 'replay-in+0.55', to: 'replay-in+3.35', tail: 0.3, note: 'the instant replay of the drive, from the sky cam' },
      // the new games
      { id: 'party-lobby', clip: 'party-lobby', from: 'start-2.05', to: 'start-0.06', tail: 0.2, note: 'PARTY: four players, SKINS, three holes' },
      { id: 'party-field', clip: 'party-lobby', from: 'start+1.6', to: 'start+3.3', tail: 0.3, note: 'the field and the draw' },
      { id: 'party-putt', clip: 'party-skin', from: 'putt+1.6', to: 'putt+3.9', tail: 0.6, note: 'the putt for the skin: IN THE HOLE!' },
      { id: 'party-skin', clip: 'party-skin', from: 'result+0.9', to: 'result+2.9', tail: 0.3, note: 'the hole result: ALEX TAKES THE SKIN' },
      { id: 'bullseye', clip: 'bullseye', from: 'ball-1+4.5', to: 'ball-1+7.3', tail: 0.3, note: 'BULLSEYE in the stadium: a ball down onto the target' },
      { id: 'bullseye-call', clip: 'bullseye', from: 'ball-1+9.05', to: 'ball-1+10.55', tail: 0.8, note: 'BULLSEYE! +50, 9.6 ft' },
      // sudden death on an arena, the winner
      { id: 'sudden', clip: 'sudden', from: 'sudden+1.3', to: 'sudden+3.9', note: 'SUDDEN DEATH, closest to the pin, in the stadium (Thunder Dome)' },
      { id: 'sd-2', clip: 'sudden', from: 'sd-2+4.6', to: 'sd-2+8.9', note: 'the second ball: through the coins, slow motion past the cup' },
      { id: 'sd-call', tail: 1.2, clip: 'sudden', from: 'sd-2+9.9', to: 'sd-2+11.2', note: 'PIN SEEKER! 1.7 ft' },
      { id: 'winner', tail: 0, clip: 'sudden', from: 'winner+0.9', to: 'winner+3.6', note: 'the winner screen: SAM WINS!, the awards, the fireworks' },
      { id: 'end', card: 'end', dur: 4.8, fadeIn: 0.25, sound: { clip: 'sudden', from: 'winner+3.6' }, joinSound: true, note: 'end card (the crowd and the fanfare run on under it)' },
    ],
    captions: [
      { card: 'cap-look', on: 'fly-dome', offset: 0.25, until: 'fly-lagoon' },
      { card: 'cap-gadgets', on: 'ring-strike', offset: 0.2, until: 'ring-call' },
      { card: 'cap-world', on: 'dragon', offset: 0.5, early: 0.2 },
      { card: 'cap-two', on: 'vs', offset: 0.9, early: 0.15 },
      { card: 'cap-replay', on: 'replay', offset: 0.3, early: 0.15 },
      { card: 'cap-bullseye', on: 'bullseye', offset: 0.2, early: 0.2 },
      { card: 'cap-free', on: 'sd-2', offset: 0.3, early: 0.3 },
    ],
    // The flyovers are filmed with the picture only. Each gets what the game's own stage intro
    // plays: a whoosh, then the announcer naming the stage. The party lobby gets the sounds of
    // its own buttons, and the end card a last cheer when the fanfare has run out. Each is one
    // file of public/arcade, played once.
    sfx: [
      { file: 'vs-slam', on: 'title', offset: 0.04, gain: 0.45 },
      { file: 'riser', on: 'menu', offset: -1.28, gain: 0.4, fadeOut: 0.05 },
      { file: 'whoosh', on: 'fly-dome', offset: -0.1, gain: 0.55 },
      { file: 'stage-thunder-dome-1', dir: 'voice/announcer', on: 'fly-dome', offset: 0.14, gain: 0.8, fadeOut: 0.12 },
      { file: 'whoosh-2', on: 'fly-sakura', offset: -0.1, gain: 0.55 },
      { file: 'stage-sakura-garden-2', dir: 'voice/announcer', on: 'fly-sakura', offset: 0.14, gain: 0.8, fadeOut: 0.12 },
      { file: 'whoosh', on: 'fly-temple', offset: -0.1, gain: 0.55 },
      { file: 'stage-temple-run-1', dir: 'voice/announcer', on: 'fly-temple', offset: 0.14, gain: 0.8, fadeOut: 0.12 },
      { file: 'whoosh-2', on: 'fly-lagoon', offset: -0.1, gain: 0.55 },
      { file: 'stage-lagoon-island-2', dir: 'voice/announcer', on: 'fly-lagoon', offset: 0.14, gain: 0.8, fadeOut: 0.12 },
      { file: 'whoosh', on: 'fly-volcano', offset: -0.1, gain: 0.55 },
      { file: 'stage-volcano-drop-1', dir: 'voice/announcer', on: 'fly-volcano', offset: 0.14, gain: 0.8, fadeOut: 0.12 },
      { file: 'whoosh-2', on: 'fly-midnight', offset: -0.1, gain: 0.55 },
      { file: 'stage-midnight-mile-2', dir: 'voice/announcer', on: 'fly-midnight', offset: 0.14, gain: 0.8, fadeOut: 0.12 },
      { file: 'whoosh', on: 'fly-frost', offset: -0.1, gain: 0.55 },
      { file: 'stage-frostbite-ridge-1', dir: 'voice/announcer', on: 'fly-frost', offset: 0.14, gain: 0.8, fadeOut: 0.12 },
      { file: 'lobby-open', on: 'party-lobby', offset: 0.02, gain: 0.5 },
      { file: 'select-format', on: 'party-lobby', offset: 1.0, gain: 0.7 },
      { file: 'start-match', on: 'party-lobby', offset: 1.82, gain: 0.6 },
      { file: 'crowd-roar-2', on: 'end', offset: 1.7, gain: 0.5, dur: 3.6, fadeOut: 1.4 },
    ],
    fadeOut: 0.5,
  },

  // ---------- the 25 to 30 second cut ----------
  short: {
    segments: [
      { id: 'open', clip: 'match', from: 'drive-0.2', to: 'drive+2.7', tail: 0.4, note: 'cold open: through the 150 MPH wall and the boost ring' },
      { id: 'open-call', clip: 'match', from: 'drive+9.9', to: 'drive+11.6', lead: 0.2, tail: 1.2, note: 'SMASHED IT!' },
      { id: 'title', clip: 'match', from: 'menu-1.65', to: 'menu-0.02', tail: 0.6, note: 'the title screen and the wordmark' },
      fly('fly-dome', 'thunder-dome', 2.3, 1.95, 'Thunder Dome'),
      fly('fly-sakura', 'sakura-garden', 0.7, 1.65, 'Sakura Garden'),
      fly('fly-midnight', 'midnight-mile', 2.9, 1.9, 'Midnight Mile at night'),
      gadget('ring', 'g-ring', 3.85, 5.4, 'the boost ring', { tail: 0.8 }),
      gadget('pad', 'g-pad', 5.85, 7.75, 'the bounce pad'),
      gadget('warp', 'g-warp', 3.9, 6.15, 'the warp pipe', { tail: 0.6 }),
      gadget('warp-call', 'g-warp', 7.75, 8.6, 'WARP SPEED!', { tail: 1.0 }),
      { id: 'dragon', clip: 'dragon', from: 'rocket-1-0.15', to: 'rocket-1+1.85', tail: 0.5, note: "Dragon's Spine: the Rocket, the cones erupt" },
      { id: 'drop', tail: 1.4, clip: 'match', from: 'putt-hero+7.6', to: 'putt-hero+11.0', note: 'slow motion, it drops: DRAINED IT!' },
      { id: 'winner', tail: 0, clip: 'sudden', from: 'winner+0.9', to: 'winner+2.9', note: 'the winner screen' },
      { id: 'end', card: 'end', dur: 3.4, fadeIn: 0.2, sound: { clip: 'sudden', from: 'winner+2.9' }, joinSound: true, note: 'end card' },
    ],
    captions: [
      { card: 'cap-look', on: 'fly-dome', offset: 0.15, until: 'fly-sakura' },
      { card: 'cap-gadgets', on: 'ring', offset: 0.15, until: 'pad' },
      { card: 'cap-world', on: 'dragon', offset: 0.3, early: 0.15 },
      { card: 'cap-free', on: 'drop', offset: 0.2, dur: 2.4 },
    ],
    sfx: [
      { file: 'vs-slam', on: 'title', offset: 0.04, gain: 0.45 },
      { file: 'whoosh', on: 'fly-dome', offset: -0.1, gain: 0.55 },
      { file: 'stage-thunder-dome-1', dir: 'voice/announcer', on: 'fly-dome', offset: 0.14, gain: 0.8, fadeOut: 0.12 },
      { file: 'whoosh-2', on: 'fly-sakura', offset: -0.1, gain: 0.55 },
      { file: 'stage-sakura-garden-2', dir: 'voice/announcer', on: 'fly-sakura', offset: 0.14, gain: 0.8, fadeOut: 0.12 },
      { file: 'whoosh-2', on: 'fly-midnight', offset: -0.1, gain: 0.55 },
      { file: 'stage-midnight-mile-2', dir: 'voice/announcer', on: 'fly-midnight', offset: 0.14, gain: 0.8, fadeOut: 0.12 },
      { file: 'crowd-roar-2', on: 'end', offset: 1.2, gain: 0.5, dur: 3.0, fadeOut: 1.2 },
    ],
    fadeOut: 0.4,
  },
};

// ---------- the silent loop (README, forum posts): five stages, the flyover, no interface ----------
const part = (stage, at, len) => ({ clip: `fly-${stage}`, from: `fly+${at}`, to: `fly+${(at + len).toFixed(2)}` });
export const loop = {
  segments: [part('thunder-dome', 2.0, 2.6), part('lagoon-island', 1.9, 2.4), part('sakura-garden', 0.5, 2.4), part('volcano-drop', 2.0, 2.4), part('midnight-mile', 2.8, 2.4)],
  cross: 0.5,
};

// ---------- the website's copies (build.mjs --only site) ----------
export const site = {
  posterAt: 1.05,   // seconds into the trailer: the frame the lightbox shows while the video loads (the 150 MPH wall)
  loop,             // the hero's loop: the same stretches, at the size the home page's budget takes
};

// ---------- thumbnails (1280 x 720) ----------
export const thumbnails = [
  { id: 'main', file: 'thumbnail.jpg', clip: 'match', at: 'drive+0.75', card: 'thumb-main' },
  { id: 'alt-1', file: 'thumbnail-alt-1-two-players.jpg', clip: 'match', at: 'start+1.55', card: 'thumb-two' },
  { id: 'alt-2', file: 'thumbnail-alt-2-smashed-it.jpg', clip: 'match', at: 'drive+10.9', zoom: 1.12, zx: 0.25, zy: 0.1, card: 'thumb-wm' },
  { id: 'alt-3', file: 'thumbnail-alt-3-stadium.jpg', clip: 'fly-thunder-dome', at: 'fly+3.4', card: 'thumb-free' },
];
