'use strict';
// The arcade announcer (docs/arcade-voice.md): the line catalogue against the v2 contract,
// the rendered packs against their manifests, the player-name API (lib/voice.js) with no
// network, and the say() queue plus ArcadeAudio's announcer wiring under a fake Web Audio.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');

const voiceLib = require('../lib/voice.js');

const REPO = path.join(__dirname, '..');
const PUBLIC = path.join(REPO, 'public', 'arcade');
const lines = () => import('../tools/arcade-voice/lines.mjs');
const queueMod = () => import('../public/arcade/voice/queue.js');
const audioMod = () => import('../public/arcade/audio.js');

// ───────────────────────── the contract's id sets, spelled out ─────────────────────────

const CALLOUTS = {
  'hole-in-one': 'HOLE IN ONE!!!', 'holed-out': 'HOLED OUT!', 'chip-in': 'CHIP IN!', drained: 'DRAINED IT!',
  'in-the-hole': 'IN THE HOLE!', 'pin-seeker': 'PIN SEEKER!', dart: 'DART!', 'dance-floor': 'ON THE DANCE FLOOR!',
  bomb: 'ABSOLUTE BOMB!', striped: 'STRIPED IT!', perfect: 'PERFECT SHOT!', 'great-shot': 'GREAT SHOT!',
  'nice-shot': 'NICE SHOT!', 'blast-off': 'BLAST OFF!', robbed: 'ROBBED!', 'so-close': 'SO CLOSE!',
  terrible: 'TERRIBLE!', 'slice-house': 'SLICE HOUSE!', 'hook-city': 'HOOK CITY!', shank: 'SHANK-A-POTAMUS!',
  'worm-burner': 'WORM BURNER!', 'sky-ball': 'SKY BALL!', chunk: 'CHUNK CITY!', splash: 'IN THE DRINK!',
  lava: 'MELTED!', ob: 'SEE YA!', beach: 'BEACH DAY!', timber: 'TIMBER!', 'on-fire': "YOU'RE ON FIRE!",
  unstoppable: 'UNSTOPPABLE!',
};

const MATCH = {
  'm-versus': 'VERSUS!', 'm-player-1': 'PLAYER ONE', 'm-player-2': 'PLAYER TWO', 'm-get-ready': 'GET READY!',
  'm-tee-off': 'TEE OFF!', 'm-youre-up': "YOU'RE UP!", 'm-wins-the-hole': 'WINS THE HOLE!',
  'm-wins-the-match': 'WINS THE MATCH!', 'm-player-1-wins': 'PLAYER ONE WINS!', 'm-player-2-wins': 'PLAYER TWO WINS!',
  'm-knockout': 'KNOCKOUT!', 'm-must-hole': 'MUST MAKE THIS!', 'm-sudden-death': 'SUDDEN DEATH!',
  'm-closest-to-the-pin': 'CLOSEST TO THE PIN!', 'm-all-square': 'ALL SQUARE!', 'm-match-point': 'MATCH POINT!',
  'm-final-hole': 'FINAL HOLE!', 'm-flawless': 'FLAWLESS VICTORY!', 'm-comeback': 'WHAT A COMEBACK!',
  'm-champion': 'CHAMPION!', 'm-quick-match': 'QUICK MATCH', 'm-best-of-3': 'BEST OF THREE',
  'm-best-of-9': 'BEST OF NINE',
  'm-hole-1': 'HOLE ONE', 'm-hole-2': 'HOLE TWO', 'm-hole-3': 'HOLE THREE', 'm-hole-4': 'HOLE FOUR',
  'm-hole-5': 'HOLE FIVE', 'm-hole-6': 'HOLE SIX', 'm-hole-7': 'HOLE SEVEN', 'm-hole-8': 'HOLE EIGHT',
  'm-hole-9': 'HOLE NINE',
  'm-takes-the-lead': 'TAKES THE LEAD!', 'm-sabotage': 'SABOTAGE!', 'm-new-record': 'NEW RECORD!',
  // added after the contract: what the player who is up is playing for
  'm-for-the-win': 'FOR THE WIN!', 'm-to-tie': 'TO TIE!', 'm-putt-in-to-win': 'PUTT IN TO WIN!',
  'm-chip-in-to-win': 'CHIP IN TO WIN!', 'm-putt-in-to-tie': 'PUTT IN TO TIE!', 'm-chip-in-to-tie': 'CHIP IN TO TIE!',
};
const AFTER_CONTRACT = ['m-for-the-win', 'm-to-tie', 'm-putt-in-to-win', 'm-chip-in-to-win', 'm-putt-in-to-tie', 'm-chip-in-to-tie'];

const STAGES = {
  'stage-lagoon-island': 'LAGOON ISLAND', 'stage-canyon-run': 'CANYON RUN', 'stage-lighthouse-point': 'LIGHTHOUSE POINT',
  'stage-volcano-drop': 'VOLCANO DROP', 'stage-frostbite-ridge': 'FROSTBITE RIDGE', 'stage-sakura-garden': 'SAKURA GARDEN',
  'stage-temple-run': 'TEMPLE RUN', 'stage-pharaohs-gate': "PHARAOH'S GATE", 'stage-midnight-mile': 'MIDNIGHT MILE',
  'stage-bullseye-bay': 'BULLSEYE BAY', 'stage-thunder-dome': 'THUNDER DOME', 'stage-ice-pick': 'ICE PICK',
  // three more stages the hole streams built after the contract was written
  'stage-dragons-spine': "DRAGON'S SPINE", 'stage-sky-fortress': 'SKY FORTRESS', 'stage-summit-express': 'SUMMIT EXPRESS',
};

const POWERUPS = {
  'pu-rocket': 'ROCKET BALL!', 'pu-sticky': 'STICKY BALL!', 'pu-magnet': 'MAGNET BALL!', 'pu-windcutter': 'WIND CUTTER!',
  'pu-laser': 'LASER BALL!', 'pu-moonball': 'MOON BALL!', 'pu-bouncy': 'BOUNCY BALL!', 'pu-fireball': 'FIREBALL!',
  'pu-ghost': 'GHOST BALL!', 'pu-skipper': 'SKIPPER!', 'pu-yoyo': 'YO-YO BALL!', 'pu-homing': 'HOMING BALL!',
  'pu-titan': 'TITAN BALL!', 'pu-feather': 'FEATHER BALL!', 'pu-gold': 'GOLDEN BALL!',
  'pu-gust': 'GUST!', 'pu-tiny-cup': 'TINY CUP!', 'pu-fog': 'FOG!',
};

// ── added after the contract by the feature streams (docs/gadgets.md, docs/modes.md) ──
const GADGETS = {
  'full-trail': 'FULL TRAIL!', 'smashed-it': 'SMASHED IT!', 'triple-up': 'TRIPLE UP!', 'warp-speed': 'WARP SPEED!',
  'ring-it': 'RING IT!', 'double-up': 'DOUBLE UP!', 'thar-she-blows': 'THAR SHE BLOWS!', boing: 'BOING!',
  pinball: 'PINBALL WIZARD!', turbo: 'TURBO!', denied: 'DENIED!', stuck: 'STUCK IN THE MUD!',
};
const PARTY = {
  'p-skins': 'SKINS', 'p-stroke-race': 'STROKE RACE', 'p-elimination': 'ELIMINATION', 'p-to-stay-alive': 'TO STAY ALIVE!',
  'p-for-the-skins': 'FOR THE SKINS!', 'p-takes-the-skin': 'TAKES THE SKIN!', 'p-skin-carries': 'THE SKIN CARRIES!',
  'p-is-out': 'IS OUT!', 'p-the-final': 'THE FINAL!', 'p-farthest-is-out': 'FARTHEST IS OUT!', 'p-wins-the-game': 'WINS THE GAME!',
  'm-player-3': 'PLAYER THREE', 'm-player-4': 'PLAYER FOUR', 'm-player-3-wins': 'PLAYER THREE WINS!', 'm-player-4-wins': 'PLAYER FOUR WINS!',
};
const BULLSEYE = {
  'be-bullseye': 'BULLSEYE!', 'be-double': 'DOUBLE!', 'be-treble': 'TREBLE!', 'be-perfect-turn': 'PERFECT TURN!', 'be-bust': 'BUST!',
  'be-check-out': 'CHECK OUT!', 'be-can-anyone-answer': 'CAN ANYONE ANSWER?', 'be-nearest-the-pin': 'NEAREST THE PIN TONIGHT!',
  'be-round-2': 'ROUND TWO', 'be-round-3': 'ROUND THREE', 'be-round-4': 'ROUND FOUR', 'be-round-5': 'ROUND FIVE', 'be-round-6': 'ROUND SIX',
  'be-final-round': 'FINAL ROUND!',
};
const DUEL = {
  'dl-call-your-shot': 'CALL YOUR SHOT!', 'dl-match-it': 'MATCH IT!', 'dl-matched': 'MATCHED!', 'dl-letter': "THAT'S A LETTER!",
  'dl-no-call': 'NO CALL!', 'dl-one-letter-left': 'ONE LETTER LEFT!', 'dl-spelled-it': 'SPELLED IT!',
};
const REPLAY = { 'm-replay': "LET'S SEE THAT AGAIN!", 'm-shot-of-the-match': 'THE SHOT OF THE MATCH!', 'm-highlights': "TONIGHT'S BEST!" };

const NEW_CUES = ['crowd-roar', 'crowd-cheer', 'crowd-ohh', 'crowd-aww', 'crowd-gasp', 'crowd-laugh', 'applause',
  'whoosh', 'vs-slam', 'drumroll', 'fanfare-win', 'fanfare-hole', 'sting-fail', 'sting-knockout', 'countdown-beep',
  'chest-open', 'coin-burst', 'trick-cast'];

const group = (LINES, g) => Object.fromEntries(LINES.filter((l) => l.group === g).map((l) => [l.id, l.text]));

// ───────────────────────────────── the line catalogue ─────────────────────────────────

test('catalogue: the callout, match, stage and power-up sets are exactly the contract\'s', async () => {
  const { LINES, LINE_IDS } = await lines();
  assert.equal(Object.keys(CALLOUTS).length, 30);
  assert.equal(Object.keys(MATCH).length, 41, "the contract's thirty-five and six added since");
  assert.equal(Object.keys(STAGES).length, 15, "the contract's twelve and three added since");
  assert.equal(Object.keys(POWERUPS).length, 18);
  assert.deepEqual(group(LINES, 'callout'), CALLOUTS);
  assert.deepEqual(group(LINES, 'match'), MATCH);
  assert.deepEqual(group(LINES, 'stage'), STAGES);
  assert.deepEqual(group(LINES, 'powerup'), POWERUPS);
  // and the sets the feature streams asked for since: gadget callouts, the party games, Bullseye, the duel, replays
  assert.deepEqual(group(LINES, 'gadget'), GADGETS);
  assert.deepEqual(group(LINES, 'party'), PARTY);
  assert.deepEqual(group(LINES, 'bullseye'), BULLSEYE);
  assert.deepEqual(group(LINES, 'duel'), DUEL);
  assert.deepEqual(group(LINES, 'replay'), REPLAY);
  assert.equal(LINES.length, 104 + 12 + 15 + 14 + 7 + 3);
  assert.equal(new Set(LINE_IDS).size, LINE_IDS.length, 'no id twice');
  for (const id of LINE_IDS) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, id);
});

test('catalogue: matches the ids and texts written in docs/dev/arcade-v2-contract.md', async () => {
  const { LINES } = await lines();
  const byId = new Map(LINES.map((l) => [l.id, l]));
  const doc = fs.readFileSync(path.join(REPO, 'docs', 'dev', 'arcade-v2-contract.md'), 'utf8').replace(/\r\n/g, '\n');

  // section 2: the callout table rows  | `id` | TEXT | when |
  const s2 = doc.slice(doc.indexOf('## 2. '), doc.indexOf('### Balls'));
  const rows = [...s2.matchAll(/^\| `([a-z0-9-]+)` \| ([^|]+?) \|/gm)];
  assert.equal(rows.length, 30, 'callout rows in the contract');
  for (const [, id, text] of rows) {
    assert.ok(byId.has(id), `callout ${id} is in the catalogue`);
    assert.equal(byId.get(id).text, text.trim(), `text of ${id}`);
    assert.equal(byId.get(id).group, 'callout');
  }

  // section 3: every `m-...` id the contract names (m-hole-1 .. m-hole-9 is a range)
  const s3 = doc.slice(doc.indexOf('## 3. '), doc.indexOf('## 4. '));
  const named = new Set([...s3.matchAll(/`(m-[a-z0-9-]+)`/g)].map((m) => m[1]));
  for (let i = 1; i <= 9; i++) named.add(`m-hole-${i}`);
  assert.deepEqual([...named].sort(), LINES.filter((l) => l.group === 'match' && !AFTER_CONTRACT.includes(l.id)).map((l) => l.id).sort());
  let texts = 0;
  for (const [, id, text] of s3.matchAll(/`(m-[a-z0-9-]+)`\s+([A-Z][A-Z' !\n]*?[A-Z!])\s*(?:·|\n·)/g)) {
    if (id === 'm-hole-1' || id === 'm-hole-9') continue;
    assert.equal(byId.get(id).text, text.replace(/\s+/g, ' ').trim(), `text of ${id}`);
    texts++;
  }
  assert.equal(texts, 26, 'every match line outside HOLE ONE .. HOLE NINE was compared with the contract text');

  // section 1: the twelve stage ids
  const s1 = doc.slice(doc.indexOf('## 1. '), doc.indexOf('### Hole file shape'));
  const stages = [...s1.matchAll(/^\| \d+ \| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
  assert.equal(stages.length, 12);
  for (const id of stages) assert.ok(byId.has(`stage-${id}`), `stage-${id}`);

  // section 5: power-up ids and their spoken names
  const s5 = doc.slice(doc.indexOf('**Power-up ids and spoken names**'), doc.indexOf('**`lib/arcade.js` exports'));
  const pus = [...s5.replace(/\n\s*/g, ' ').matchAll(/`([a-z-]+)` ([A-Z][A-Z -]*!)/g)];
  assert.equal(pus.length, 18);
  for (const [, id, text] of pus) assert.equal(byId.get(`pu-${id}`).text, text, `pu-${id}`);

  // section 3: the new one-shot cues
  const cues = s3.slice(s3.indexOf('New one-shot SFX cues'));
  const { NEW_SFX_CUES, SFX_CUES } = await lines();
  assert.deepEqual(NEW_SFX_CUES, NEW_CUES);
  for (const c of NEW_CUES) {
    assert.ok(cues.includes(`\`${c}\``), `the contract names ${c}`);
    assert.ok(SFX_CUES.includes(c), `${c} has a prompt`);
  }
});

test('catalogue: agrees with what the game itself defines (callouts, power-ups, stages), where that exists', async () => {
  const { LINES } = await lines();
  const byId = new Map(LINES.map((l) => [l.id, l]));
  let arcade = null;
  try { arcade = require('../lib/arcade.js'); } catch (_) { /* another stream is mid-edit */ }
  if (arcade && arcade.CALLOUTS && typeof arcade.CALLOUTS === 'object') {
    for (const [id, c] of Object.entries(arcade.CALLOUTS)) {
      const voiceId = (c && c.voice) || id;
      assert.ok(byId.has(voiceId), `the game's callout ${id} has a voice line`);
      if (c && typeof c.text === 'string') assert.equal(byId.get(voiceId).text, c.text, `the banner and the voice agree on ${id}`);
    }
  }
  // a course gadget's callout (lib/gadgets.js GADGET_CALLOUTS) is spoken by its own id
  if (arcade && arcade.GADGET_CALLOUTS && typeof arcade.GADGET_CALLOUTS === 'object') {
    assert.deepEqual(Object.keys(arcade.GADGET_CALLOUTS).sort(), Object.keys(GADGETS).sort(), 'every gadget callout has a line, and no line is left over');
    for (const [id, c] of Object.entries(arcade.GADGET_CALLOUTS)) assert.equal(byId.get(id).text, c.text, `the banner and the voice agree on ${id}`);
  }
  const pus = arcade && Array.isArray(arcade.POWERUPS) ? arcade.POWERUPS : [];
  for (const p of pus) assert.ok(byId.has(`pu-${p.id}`), `power-up ${p.id} has a voice line`);
  const holesDir = path.join(REPO, 'tools', 'arcade-holes', 'holes');
  for (const f of fs.existsSync(holesDir) ? fs.readdirSync(holesDir).filter((x) => x.endsWith('.js')) : []) {
    assert.ok(byId.has(`stage-${f.slice(0, -3)}`), `stage ${f} has a voice line`);
  }
});

test('catalogue: every line has two or three takes, and every take says the line and nothing else', async () => {
  const { LINES, compareWords, catalogueCharacters, durationBounds } = await lines();
  for (const l of LINES) {
    assert.ok(l.takes.length >= 2 && l.takes.length <= 3, `${l.id}: ${l.takes.length} takes`);
    assert.equal(new Set(l.takes).size, l.takes.length, `${l.id}: takes differ`);
    for (const t of l.takes) {
      assert.match(t, /^\[[a-z ,'-]+\] \S/, `${l.id}: a take starts with one delivery tag`);
      assert.ok(t.length <= 90, `${l.id}: take is short`);
      const spoken = t.replace(/\[[^\]]*\]/g, ' ');
      assert.ok(!/[[\]]/.test(spoken), `${l.id}: balanced tags`);
      assert.deepEqual(compareWords(spoken, l.text), { ok: true, extra: [], missing: [] }, `${l.id}: "${t}"`);
    }
    const b = durationBounds(l);
    assert.ok(b.minS >= 0.3 && b.minS < 1 && b.maxS > 1.5 && b.maxS <= 5, `${l.id}: sane bounds`);
  }
  // budget: one pack is well under 20,000 characters (the brief allows 60,000 in all)
  assert.ok(catalogueCharacters() < 20000, `catalogue is ${catalogueCharacters()} characters`);
});

test('catalogue: compareWords forgives a stretched shout and catches stray speech', async () => {
  const { compareWords } = await lines();
  for (const [heard, text] of [['Slice house!', 'SLICE HOUSE!'], ['Sliiice hooouse.', 'SLICE HOUSE!'], ['Knock out!', 'KNOCKOUT!'],
    ['Shankapotamus', 'SHANK-A-POTAMUS!'], ['Hole in one! Hole in one!', 'HOLE IN ONE!!!'], ['You are on fire', "YOU'RE ON FIRE!"]]) {
    assert.equal(compareWords(heard, text).ok, true, heard);
  }
  assert.deepEqual(compareWords('Nice shot! What a beauty.', 'NICE SHOT!').extra, ['what', 'a', 'beauty']);
  assert.deepEqual(compareWords('Nice.', 'NICE SHOT!').missing, ['shot']);
});

test('sfx catalogue: one-shots only, inside the contract\'s lengths, two takes of every crowd reaction', async () => {
  const { SFX, SFX_ALIASES, sfxFiles } = await lines();
  const by = new Map(SFX.map((s) => [s.cue, s]));
  assert.ok(by.get('drumroll').keepS < 3);
  assert.ok(by.get('fanfare-win').keepS < 6);
  assert.ok(by.get('fanfare-hole').keepS < 3);
  const { PHYSICAL_SFX_CUES, FEEL_SFX_CUES, NEW_SFX_CUES } = await lines();
  assert.deepEqual(PHYSICAL_SFX_CUES, ['cup-drop', 'flag-clank', 'green-thump', 'fairway-bounce', 'sand-thud', 'tree-knock',
    'water-plunk', 'lava-sizzle', 'ice-skid', 'rough-rustle']);
  assert.deepEqual(FEEL_SFX_CUES, ['ui-tick', 'ui-confirm', 'ui-back', 'turn-chime', 'arm-common', 'arm-rare', 'arm-epic',
    'trophy-tick', 'confetti-pop', 'riser', 'heartbeat-hit', 'streak-up', 'streak-break']);
  assert.deepEqual(SFX.map((s) => s.cue).sort(), [...NEW_SFX_CUES, ...PHYSICAL_SFX_CUES, ...FEEL_SFX_CUES, 'oooh'].sort(),
    'every cue has exactly one prompt');
  assert.ok(by.get('riser').keepS < 2.5, 'the riser is one rise under 2.5 s');
  assert.ok(by.get('ui-tick').keepS <= 0.15 && by.get('trophy-tick').keepS <= 0.15, 'the ticks are tiny');
  for (const c of ['cup-drop', 'flag-clank', 'green-thump', 'fairway-bounce', 'sand-thud', 'tree-knock', 'rough-rustle']) {
    assert.equal(by.get(c).takes, 2, `${c}: two takes, it comes round often`);
  }
  for (const c of ['ui-tick', 'ui-confirm', 'ui-back', 'trophy-tick']) assert.ok(by.get(c).lufs <= -25, `${c}: the interface is levelled lowest`);
  for (const s of SFX) {
    assert.ok(s.seconds >= 0.5 && s.seconds <= 6, `${s.cue}: asks for a short clip`);
    assert.ok(s.keepS <= s.seconds && s.keepS < 6, `${s.cue}: kept short`);
    assert.ok(s.fadeMs >= 30, `${s.cue}: a faded tail`);
    assert.ok(!/\bloop|ambien|background|bed\b/i.test(s.prompt), `${s.cue}: not a bed`);
    assert.ok(!/clash|pga|nintendo|ea sports/i.test(s.prompt), `${s.cue}: no other game named`);
    if (/^crowd-/.test(s.cue)) assert.equal(s.takes, 2, `${s.cue}: two takes`);
  }
  assert.deepEqual(sfxFiles(by.get('crowd-roar')), ['crowd-roar.mp3', 'crowd-roar-2.mp3']);
  assert.deepEqual(sfxFiles(by.get('whoosh')), ['whoosh.mp3']);
  for (const target of Object.values(SFX_ALIASES)) assert.ok(by.has(target));
  assert.ok(SFX.reduce((n, s) => n + s.takes, 0) <= 70, 'inside the generation budget');
});

// ─────────────────────────────── what is on disk ───────────────────────────────

const isMp3 = (file) => {
  const b = fs.readFileSync(file);
  if (b.length < 400) return false;
  const id3 = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
  return id3 || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
};

test('rendered voice packs: the manifest and the files on disk agree', async (t) => {
  const { LINES } = await lines();
  const byId = new Map(LINES.map((l) => [l.id, l]));
  const root = path.join(PUBLIC, 'voice');
  const packs = fs.existsSync(root)
    ? fs.readdirSync(root).filter((p) => fs.existsSync(path.join(root, p, 'manifest.json'))) : [];
  if (!packs.length) { t.skip('no announcer pack has been rendered yet (node tools/arcade-voice/generate.mjs voice)'); return; }
  for (const pack of packs) {
    const dir = path.join(root, pack);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(m.pack, pack);
    assert.match(m.voice.id, /^[A-Za-z0-9-]{8,40}$/);
    assert.equal(typeof m.voice.model, 'string');
    const listed = new Set();
    for (const [id, e] of Object.entries(m.lines)) {
      assert.ok(byId.has(id), `${pack}: ${id} is a catalogue line`);
      assert.equal(e.text, byId.get(id).text, `${pack}: text of ${id}`);
      assert.ok(e.files.length >= 1 && e.files.length <= 3, `${pack}: ${id} has takes`);
      for (const f of e.files) {
        assert.match(f, new RegExp(`^${id}-[1-3]\\.mp3$`), `${pack}: ${f} is named for its line`);
        assert.ok(fs.existsSync(path.join(dir, f)), `${pack}: ${f} exists`);
        assert.ok(isMp3(path.join(dir, f)), `${pack}: ${f} is an mp3`);
        listed.add(f);
      }
    }
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mp3'))) assert.ok(listed.has(f), `${pack}: ${f} is in the manifest`);
    // a finished pack speaks every line; a partial one (a run that stopped) is reported, not hidden
    const missing = LINES.filter((l) => !m.lines[l.id]).map((l) => l.id);
    if (missing.length) t.diagnostic(`${pack}: ${missing.length} line(s) not rendered yet: ${missing.slice(0, 8).join(', ')}`);
    if (pack === 'announcer') assert.deepEqual(missing, [], 'the default pack speaks every line');
  }
});

test('shipped sound effects: the manifest, the files on disk, the source list and CREDITS.md all agree', async (t) => {
  const dir = path.join(PUBLIC, 'sfx');
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) { t.skip('no sound effects have been built yet (node tools/arcade-voice/import.mjs)'); return; }
  const { IMPORTS, FREESOUND, PACKS_KENNEY, GENERATED, cueOfFile } = await import('../tools/arcade-voice/sources.mjs');
  const { SFX_ALIASES } = await lines();
  const { CUE_NAMES, SAMPLE_CUE_NAMES, CUE_CATEGORY } = await audioMod();
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const onDisk = fs.readdirSync(dir).filter((x) => x.endsWith('.mp3'));
  const listed = new Set();
  for (const [cue, e] of Object.entries(m.cues)) {
    assert.ok(CUE_NAMES.includes(cue) || /^stage-sting-[a-z]+$/.test(cue), `${cue} is a cue audio.js knows`);
    if (e.alias) {
      assert.equal(SFX_ALIASES[cue], e.alias);
      assert.deepEqual(e.files, m.cues[e.alias].files);
      continue;
    }
    assert.ok(e.files.length >= 1 && e.files.length <= 4, `${cue} has takes`);
    for (const f of [...e.files, ...(e.hard || [])]) {
      const c = cueOfFile(f);
      assert.equal(c.cue, cue, `${f} is named for ${cue}`);
      assert.equal(c.hard, (e.hard || []).includes(f));
      assert.ok(isMp3(path.join(dir, f)), `${f} is an mp3`);
      listed.add(f);
    }
  }
  for (const f of onDisk) assert.ok(listed.has(f), `${f} is in the manifest`);
  // nothing the game can ask for is silent any more: every sample-only cue has its file
  for (const c of SAMPLE_CUE_NAMES) assert.ok(m.cues[c], `cue ${c} has real audio`);
  for (const c of NEW_CUES) assert.ok(m.cues[c], `the contract's cue ${c} has real audio`);
  // the setup flow, the swell of anticipation, the strike with its hard takes
  for (const c of ['lobby-open', 'ui-tick', 'select-player', 'select-format', 'select-stage', 'toggle-on', 'toggle-off', 'drawer-open',
    'drawer-close', 'ui-back', 'ui-error', 'start-match', 'vs-slam', 'coin-flip', 'coin-land', 'stage-sting', 'tee-off', 'whoosh']) {
    assert.ok(m.cues[c] && !m.cues[c].alias, `setup cue ${c} has its own file`);
  }
  assert.ok(m.cues.whoosh.files.length >= 3 && m.cues['vs-slam'].files.length >= 2, 'the wipes and the slam have takes');
  assert.ok(m.cues.strike.files.length >= 3 && m.cues.strike.hard.length >= 2, 'the strike: several takes, heavier ones for speed');
  for (const [c, peak] of [['crowd-rise-1s', 1.2], ['crowd-rise-2s', 2], ['crowd-rise-3s', 3], ['crowd-rise-4s', 4.5]]) {
    assert.equal(m.cues[c].peakS, peak, `${c} says where its peak is`);
    assert.equal(m.cues[c].files.length, 2, `${c}: two takes`);
  }
  for (const c of ['crowd-roar', 'crowd-cheer', 'crowd-ohh', 'crowd-aww', 'crowd-gasp', 'crowd-laugh', 'applause']) assert.equal(m.cues[c].files.length, 2, `${c}: two takes`);

  // every shipped file has a source entry, every source is a free one, and CREDITS.md records it
  const specs = new Map(IMPORTS.map((x) => [x.file, x]));
  assert.equal(specs.size, IMPORTS.length, 'no file is built twice');
  const credits = fs.readFileSync(path.join(dir, 'CREDITS.md'), 'utf8');
  for (const f of onDisk) {
    const spec = specs.get(f);
    assert.ok(spec, `${f} is listed in tools/arcade-voice/sources.mjs`);
    assert.ok(credits.includes(`| \`${f}\` |`), `${f} is in CREDITS.md`);
    assert.ok(CUE_CATEGORY[cueOfFile(f).cue], `${f} belongs to a cue with a place in the mix`);
    for (const l of spec.layers) {
      const [kind, rest] = [l.src.slice(0, 2), l.src.slice(2)];
      if (kind === 'k:') assert.ok(PACKS_KENNEY[rest.split('/')[0]], `${l.src}: a Kenney CC0 pack`);
      else if (kind === 'f:') {
        assert.ok(FREESOUND[rest], `${l.src}: a freesound sound checked as CC0`);
        assert.ok(credits.includes(`/sounds/${rest}/`), `${l.src}: its page is in CREDITS.md`);
      } else if (kind === 'h:') assert.ok(GENERATED[rest], `${l.src}: generated for this project`);
      else assert.fail(`${l.src}: unknown kind of source`);
    }
  }
  assert.match(credits, /CC0 1\.0/);
  assert.match(credits, /Nothing here comes from a commercial game/);
  assert.ok(!/cloudfront|user_[A-Za-z0-9]{10,}/.test(credits), 'no account address in the credits');
  for (const src of [fs.readFileSync(path.join(REPO, 'tools', 'arcade-voice', 'sources.mjs'), 'utf8'), credits]) {
    assert.ok(!/youtube|youtu\.be|zapsplat|pga ?tour/i.test(src), 'no broadcast, video or restricted-library source');
  }
  // one-shots only, and a size that ships
  const bytes = onDisk.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  assert.ok(bytes < 12 * 1048576, `effects are ${(bytes / 1048576).toFixed(1)} MB`);
  t.diagnostic(`${onDisk.length} effect files, ${Object.keys(m.cues).length} cues, ${(bytes / 1048576).toFixed(2)} MB`);
});

test('render pipeline (placeholder audio, no network): trim, level, encode, manifest, machine check, idempotent', async (t) => {
  // needs the dev-only codecs of tools/arcade-voice (npm install --ignore-scripts in that folder)
  const tool = path.join(REPO, 'tools', 'arcade-voice');
  if (!fs.existsSync(path.join(tool, 'node_modules', 'mpg123-decoder')) || !fs.existsSync(path.join(tool, 'node_modules', '@breezystack', 'lamejs'))) {
    t.skip('the codecs are not installed (cd tools/arcade-voice && npm install --ignore-scripts)');
    return;
  }
  const { execFileSync } = require('node:child_process');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-voice-render-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const only = 'nice-shot,slice-house,m-knockout,hole-in-one,pu-fog,crowd-roar,whoosh,countdown-beep,drumroll,fanfare-win,fanfare-hole';
  const run = () => execFileSync(process.execPath, [path.join(tool, 'generate.mjs'), 'all', '--mock', '--out', out, '--only', only],
    { encoding: 'utf8', env: { ...process.env, ELEVENLABS_API_KEY: '', BIRDIE_VOICE_ENV: '' } });
  const first = run();
  assert.match(first, /voice pack "announcer": 14 rendered, 0 failed, 14 files in the manifest/);
  assert.match(first, /sfx: 7 generated, 0 failed, 7 files in the manifest/);
  const again = run();
  assert.match(again, /0 takes to render/);
  assert.match(again, /0 clips to generate/);
  assert.throws(() => execFileSync(process.execPath, [path.join(tool, 'generate.mjs'), '--mock'], { encoding: 'utf8', stdio: 'pipe' }),
    /--out/, 'placeholder audio can never be written into public/');

  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'voice', 'announcer', 'manifest.json'), 'utf8'));
  assert.equal(manifest.pack, 'announcer');
  assert.deepEqual(manifest.lines['slice-house'], { text: 'SLICE HOUSE!', files: ['slice-house-1.mp3', 'slice-house-2.mp3', 'slice-house-3.mp3'] });
  assert.equal(manifest.names.delivery, '[shouting] {NAME}!');
  const sfx = JSON.parse(fs.readFileSync(path.join(out, 'sfx', 'manifest.json'), 'utf8'));
  assert.deepEqual(sfx.cues['crowd-roar'].files, ['crowd-roar.mp3', 'crowd-roar-2.mp3']);
  assert.deepEqual(sfx.cues.roar, { files: ['crowd-roar.mp3', 'crowd-roar-2.mp3'], alias: 'crowd-roar' });

  const { checkAll } = await import('../tools/arcade-voice/check.mjs');
  const { VOICE_FORMAT, SFX_FORMAT } = await import('../tools/arcade-voice/generate.mjs');
  const results = await checkAll({ dir: out });
  const voice = results.find((r) => r.pack === 'announcer');
  assert.equal(voice.files.length, 14);
  for (const r of voice.files) {
    assert.deepEqual(r.fail, [], `${r.file}: ${r.fail.join('; ')}`);
    assert.deepEqual(r.warn, [], `${r.file}: ${r.warn.join('; ')}`);
    assert.equal(r.channels, 1, `${r.file} is mono`);
    assert.equal(r.sampleRate, 44100);
    assert.ok(Math.abs(r.lufs - VOICE_FORMAT.lufs) < 1.5, `${r.file} loudness ${r.lufs}`);
    assert.ok(r.peakDb < -0.3, `${r.file} does not clip`);
    assert.ok(r.leadMs <= 60 && r.tailMs <= 260, `${r.file} is trimmed (${r.leadMs} / ${r.tailMs} ms)`);
  }
  const fx = results.find((r) => r.pack === 'sfx');
  assert.equal(fx.files.length, 7);
  for (const r of fx.files) {
    assert.deepEqual(r.fail, [], `${r.file}: ${r.fail.join('; ')}`);
    assert.ok(Math.abs(r.lufs - SFX_FORMAT.lufs) < 3, `${r.file} loudness ${r.lufs}`);
    assert.ok(r.lufs < VOICE_FORMAT.lufs - 3, `${r.file} sits under the voice`);
    assert.ok(r.endDb < -36, `${r.file} has a clean tail`);
  }
  const len = Object.fromEntries(fx.files.map((r) => [r.file, r.durationS]));
  assert.ok(len['drumroll.mp3'] < 3 && len['fanfare-win.mp3'] < 6 && len['fanfare-hole.mp3'] < 3 && len['countdown-beep.mp3'] < 0.5);
  // the checker does notice what is not there
  assert.ok(voice.fails.some((f) => /line terrible is not in the manifest/.test(f)));
  assert.ok(fx.fails.some((f) => /cue applause is not in the manifest/.test(f)));
});

// ─────────────────────────────── lib/voice.js ───────────────────────────────

test('voice key: only the ELEVENLABS_API_KEY line is read, in the order the contract gives', () => {
  const { parseKeyLine, loadKey } = voiceLib;
  assert.equal(parseKeyLine('OTHER=1\nELEVENLABS_API_KEY=sk_abc123\nMORE=2'), 'sk_abc123');
  assert.equal(parseKeyLine('export ELEVENLABS_API_KEY="sk_quoted"\r\n'), 'sk_quoted');
  assert.equal(parseKeyLine("  ELEVENLABS_API_KEY = 'sk_single'  "), 'sk_single');
  assert.equal(parseKeyLine('ELEVENLABS_API_KEY=sk_x # the key'), 'sk_x');
  assert.equal(parseKeyLine('# ELEVENLABS_API_KEY=sk_commented\nXELEVENLABS_API_KEY=no'), null);
  assert.equal(parseKeyLine('ELEVENLABS_API_KEY=\nELEVENLABS_API_KEY=sk_second'), 'sk_second');
  assert.equal(parseKeyLine(''), null);

  const files = { 'named.env': 'ELEVENLABS_API_KEY=sk_named', 'default.env': 'A=1\nELEVENLABS_API_KEY=sk_default' };
  const read = [];
  const readFile = (f) => { read.push(f); if (!(f in files)) throw new Error('ENOENT'); return files[f]; };
  assert.equal(loadKey({ env: { ELEVENLABS_API_KEY: ' sk_env ', BIRDIE_VOICE_ENV: 'named.env' }, files: ['default.env'], readFile }), 'sk_env');
  assert.deepEqual(read, [], 'the environment wins without touching a file');
  assert.equal(loadKey({ env: { BIRDIE_VOICE_ENV: 'named.env' }, files: ['default.env'], readFile }), 'sk_named');
  assert.equal(loadKey({ env: { BIRDIE_VOICE_ENV: 'missing.env' }, files: ['default.env'], readFile }), 'sk_default');
  assert.equal(loadKey({ env: {}, files: ['nope.env'], readFile }), null);
  assert.equal(loadKey({ env: {}, files: [], readFile }), null);
});

test('voice names: validation, slugs (same in the browser module), and what is spoken', async () => {
  const { validateName, nameSlug, nameText, NAME_MAX } = voiceLib;
  const q = await queueMod();
  assert.deepEqual(validateName('  Alex  '), { ok: true, name: 'Alex' });
  assert.deepEqual(validateName("Mary-Jo  O'Neil Jr."), { ok: true, name: "Mary-Jo O'Neil Jr." });
  assert.equal(validateName('José').ok, true);
  assert.equal(validateName('P2').ok, true);
  for (const bad of ['', '   ', null, undefined, 42, {}, '[laughing] Bob', 'Bob<script>', 'a/b', '..', '--', 'Bob\u0000', 'x'.repeat(NAME_MAX + 1), 'Bob; DROP', 'a\\b', 'Bob "the man"']) {
    assert.equal(validateName(bad).ok, false, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(validateName('x'.repeat(NAME_MAX)).ok, true);
  assert.equal(validateName('Bob\nSmith').name, 'Bob Smith', 'whitespace collapses');

  const cases = { Alex: 'alex', '  Mary-Jo  O’Neil ': 'mary-jo-o-neil', 'José': 'jose', 'P2': 'p2', 'Dr. No': 'dr-no',
    'ÅSA': 'asa', '李': 'u-674e', '': '', '---': 'u-2d-2d-2d', ['A'.repeat(60)]: 'a'.repeat(40) };
  for (const [name, slug] of Object.entries(cases)) {
    assert.equal(nameSlug(name), slug, `slug of ${JSON.stringify(name)}`);
    assert.equal(q.nameSlug(name), slug, `the browser slug of ${JSON.stringify(name)}`);
    if (slug) assert.match(slug, /^[a-z0-9][a-z0-9-]{0,47}$/);
  }
  for (const name of ['Alex', 'Zoë Q.', 'Ünal', 'Player 12', "D'Arcy", 'Ωmega', 'Łukasz', '  x  ']) {
    assert.equal(nameSlug(name), q.nameSlug(name), name);
  }
  assert.equal(nameText('Alex'), '[shouting] ALEX!');
  assert.equal(nameText('Dr. No.'), '[shouting] DR. NO!');
  assert.equal(nameText('Alex', '[booming] {NAME}!!'), '[booming] ALEX!!');
  assert.equal(nameText('Alex', 'no placeholder'), '[shouting] ALEX!');
});

const tmpDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'birdie-voice-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
// these tests are about the built-in name voice: no rendered pack may stand in for it
const NO_PACKS = path.join(os.tmpdir(), 'birdie-voice-no-packs');
const fakeMp3 = (bytes = 20000) => { const b = Buffer.alloc(bytes, 0x55); b[0] = 0xff; b[1] = 0xfb; return b; };
const okFetch = (calls, bytes) => async (url, init) => {
  calls.push({ url: String(url), init });
  await new Promise((r) => setTimeout(r, 5));
  const buf = fakeMp3(typeof bytes === 'function' ? bytes(calls.length) : bytes);
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
};

test('voice names: no key answers { ok: false } without touching the network', async (t) => {
  const dataDir = tmpDir(t);
  const calls = [];
  const v = voiceLib.createVoice({ publicDir: NO_PACKS, dataDir, env: {}, keyFiles: [], fetchImpl: okFetch(calls), log: () => {} });
  assert.deepEqual(await v.renderName('Alex'), { ok: false, error: 'no-key' });
  assert.equal(calls.length, 0);
  assert.deepEqual(v.listNames(), []);
  assert.equal(fs.existsSync(path.join(dataDir, 'voice')), false, 'nothing written');
});

test('voice names: rendered once, cached on disk, concurrent requests share one render, only the name leaves', async (t) => {
  const dataDir = tmpDir(t);
  const calls = [];
  const KEY = 'sk_test_key_never_real';
  const v = voiceLib.createVoice({ publicDir: NO_PACKS, dataDir, env: { ELEVENLABS_API_KEY: KEY }, keyFiles: [], fetchImpl: okFetch(calls), log: () => {} });
  const [a, b, c] = await Promise.all([v.renderName('Alex'), v.renderName(' alex '), v.renderName('ALEX')]);
  assert.equal(calls.length, 1, 'one render for three concurrent requests');
  for (const r of [a, b, c]) { assert.equal(r.ok, true); assert.equal(r.slug, 'alex'); assert.equal(r.url, '/voice/names/alex.mp3'); }
  const file = path.join(dataDir, 'voice', 'names', 'alex.mp3');
  assert.equal(fs.statSync(file).size, 20000);

  const again = await v.renderName('Alex');
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1, 'the second time comes from disk');
  assert.deepEqual(v.listNames(), [{ slug: 'alex', name: 'Alex', url: '/voice/names/alex.mp3' }]);

  // what was sent: the key only in the header, the text and voice settings only in the body
  const { url, init } = calls[0];
  const u = new URL(url);
  assert.equal(u.origin, 'https://api.elevenlabs.io');
  assert.match(u.pathname, /^\/v1\/text-to-speech\/[A-Za-z0-9]+$/);
  assert.ok(!url.includes(KEY), 'the key is never in the address');
  assert.equal(init.headers['xi-api-key'], KEY);
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ['model_id', 'text', 'voice_settings']);
  assert.equal(body.text, '[shouting] ALEX!');
  assert.ok(!init.body.includes(KEY));
  // nothing on disk holds the key
  for (const f of fs.readdirSync(path.join(dataDir, 'voice', 'names'))) {
    assert.ok(!fs.readFileSync(path.join(dataDir, 'voice', 'names', f)).includes(KEY), `${f} does not hold the key`);
  }
});

test('voice names: bad names, unknown packs, API errors and a dead network are clean { ok: false }', async (t) => {
  const dataDir = tmpDir(t);
  const env = { ELEVENLABS_API_KEY: 'sk_x' };
  const calls = [];
  const v = voiceLib.createVoice({ publicDir: NO_PACKS, dataDir, env, keyFiles: [], fetchImpl: okFetch(calls), log: () => {} });
  assert.deepEqual(await v.renderName('[shouting] hi'), { ok: false, error: 'name-invalid' });
  assert.deepEqual(await v.renderName(''), { ok: false, error: 'name-required' });
  assert.deepEqual(await v.renderName('x'.repeat(40)), { ok: false, error: 'name-too-long' });
  assert.deepEqual(await v.renderName('Alex', '../etc'), { ok: false, error: 'unknown-pack' });
  assert.deepEqual(await v.renderName('Alex', 'no-such-pack'), { ok: false, error: 'unknown-pack' });
  assert.equal(calls.length, 0);

  const dead = voiceLib.createVoice({ publicDir: NO_PACKS, dataDir, env, keyFiles: [], fetchImpl: async () => { throw new Error('ENOTFOUND'); }, log: () => {} });
  assert.deepEqual(await dead.renderName('Alex'), { ok: false, error: 'network' });
  const denied = voiceLib.createVoice({ publicDir: NO_PACKS, dataDir, env, keyFiles: [], fetchImpl: async () => ({ ok: false, status: 401 }), log: () => {} });
  assert.deepEqual(await denied.renderName('Alex'), { ok: false, error: 'api-401' });
  const empty = voiceLib.createVoice({ publicDir: NO_PACKS, dataDir, env, keyFiles: [], fetchImpl: okFetch([], 10), log: () => {} });
  assert.deepEqual(await empty.renderName('Alex'), { ok: false, error: 'api-empty' });
  assert.deepEqual(v.listNames(), [], 'a failed render leaves no file');
});

test('voice names: a name that comes back as a ramble is rendered once more and the shorter one kept', async (t) => {
  const dataDir = tmpDir(t);
  const calls = [];
  // first answer is 6 s of audio at 128 kbit/s, the second 1 s
  const v = voiceLib.createVoice({ publicDir: NO_PACKS, dataDir, env: { ELEVENLABS_API_KEY: 'sk_x' }, keyFiles: [], log: () => {},
    fetchImpl: okFetch(calls, (n) => (n === 1 ? 96000 : 16000)) });
  const r = await v.renderName('Alex');
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(fs.statSync(path.join(dataDir, 'voice', 'names', 'alex.mp3')).size, 16000);
});

test('voice names: another pack renders with that pack\'s voice into its own folder', async (t) => {
  const dataDir = tmpDir(t);
  const publicDir = tmpDir(t);
  fs.mkdirSync(path.join(publicDir, 'arcade', 'voice', 'arena'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'arcade', 'voice', 'arena', 'manifest.json'), JSON.stringify({
    pack: 'arena', voice: { id: 'ArenaVoiceId0001', model: 'eleven_v3', settings: { stability: 0.4 } }, names: { delivery: '[booming] {NAME}!' }, lines: {},
  }));
  const calls = [];
  const v = voiceLib.createVoice({ dataDir, publicDir, env: { ELEVENLABS_API_KEY: 'sk_x' }, keyFiles: [], fetchImpl: okFetch(calls), log: () => {} });
  const r = await v.renderName('Alex', 'arena');
  assert.equal(r.url, '/voice/names/arena/alex.mp3');
  assert.match(calls[0].url, /\/text-to-speech\/ArenaVoiceId0001\?/);
  assert.equal(JSON.parse(calls[0].init.body).text, '[booming] ALEX!');
  assert.ok(fs.existsSync(path.join(dataDir, 'voice', 'names', 'arena', 'alex.mp3')));
  assert.deepEqual(v.listNames('arena').map((n) => n.slug), ['alex']);
  assert.deepEqual(v.listNames(), [], 'the default pack has its own list');
  // a pack rendered with a voice this key cannot reach has no name voice: a clean no, and nothing is sent
  fs.mkdirSync(path.join(publicDir, 'arcade', 'voice', 'elsewhere'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'arcade', 'voice', 'elsewhere', 'manifest.json'), JSON.stringify({
    pack: 'elsewhere', voice: { id: 'e2a2d2e6-9ed2-59cd-82af-feaa27f8a678', model: 'elevenlabs_v4', provider: 'higgsfield' }, lines: {} }));
  const sent = calls.length;
  assert.deepEqual(await v.renderName('Alex', 'elsewhere'), { ok: false, error: 'no-name-voice' });
  assert.equal(calls.length, sent);
  // the default pack works without a manifest (the built-in voice)
  assert.equal((await v.renderName('Alex')).url, '/voice/names/alex.mp3');
  assert.match(calls[1].url, new RegExp(`/text-to-speech/${voiceLib.DEFAULT_VOICE.id}\\?`));
});

// a request and a response good enough for lib/voice.js handle()
function fakeReq(method, url, body) {
  const r = Readable.from(body == null ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  r.method = method;
  r.url = url;
  return r;
}
function fakeRes() {
  const chunks = [];
  const w = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
  w.status = 0;
  w.headers = {};
  w.writeHead = (code, headers = {}) => { w.status = code; w.headers = headers; return w; };
  w.done = new Promise((resolve) => w.on('finish', resolve));
  w.body = () => Buffer.concat(chunks);
  w.json = () => JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return w;
}

test('voice routes: POST /api/voice/name, GET /api/voice/names, GET /voice/names/<slug>.mp3', async (t) => {
  const dataDir = tmpDir(t);
  const calls = [];
  const v = voiceLib.createVoice({ publicDir: NO_PACKS, dataDir, env: { ELEVENLABS_API_KEY: 'sk_x' }, keyFiles: [], fetchImpl: okFetch(calls), log: () => {} });
  const call = async (method, url, body) => {
    const res = fakeRes();
    assert.equal(await v.handle(fakeReq(method, url, body), res), true);
    await res.done;
    return res;
  };
  for (const p of ['/api/voice/name', '/api/voice/names', '/voice/names/x.mp3']) assert.equal(v.matches(p), true);
  for (const p of ['/api/voices', '/voice/other', '/arcade/voice/announcer/manifest.json']) assert.equal(v.matches(p), false);

  let res = await call('POST', '/api/voice/name', { name: 'Alex' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), { ok: true, slug: 'alex', name: 'Alex', pack: 'announcer', url: '/voice/names/alex.mp3', cached: false });

  res = await call('GET', '/api/voice/names');
  assert.deepEqual(res.json(), { ok: true, pack: 'announcer', names: [{ slug: 'alex', name: 'Alex', url: '/voice/names/alex.mp3' }], key: true });

  res = await call('GET', '/voice/names/alex.mp3');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'audio/mpeg');
  assert.equal(res.body().length, 20000);
  res = await call('HEAD', '/voice/names/alex.mp3');
  assert.equal(res.status, 200);
  assert.equal(res.body().length, 0);

  // nothing outside the names folder can be reached, and nothing else is served
  for (const bad of ['/voice/names/nope.mp3', '/voice/names/../../settings.json', '/voice/names/%2e%2e/x.mp3', '/voice/names/index.json', '/voice/names/ALEX.mp3', '/voice/names/a/b/c.mp3']) {
    assert.equal((await call('GET', bad)).status, 404, bad);
  }
  assert.equal((await call('POST', '/api/voice/name', { name: '<b>' })).status, 400);
  assert.equal((await call('POST', '/api/voice/name', '{not json')).status, 400);
  assert.equal((await call('POST', '/api/voice/name', { name: 'x'.repeat(5000) })).status, 400);
  assert.equal((await call('GET', '/api/voice/name')).status, 405);
  assert.equal((await call('DELETE', '/voice/names/alex.mp3')).status, 405);
  assert.equal(calls.length, 1, 'only the one good name reached the voice API');

  // no key: the lobby gets a clean { ok: false } with a 200 (it then uses the fallback line)
  const nokey = voiceLib.createVoice({ publicDir: NO_PACKS, dataDir: tmpDir(t), env: {}, keyFiles: [], fetchImpl: okFetch(calls), log: () => {} });
  const r2 = fakeRes();
  await nokey.handle(fakeReq('POST', '/api/voice/name', { name: 'Alex' }), r2);
  await r2.done;
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.json(), { ok: false, error: 'no-key' });
});

test('server.js hands voice requests to lib/voice.js with one marked hook', () => {
  const src = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
  const hooks = src.split(/\r?\n/).filter((l) => l.includes('// v2:voice'));
  assert.equal(hooks.length, 1);
  assert.match(hooks[0], /require\('\.\/lib\/voice'\)\.handle\(req, res, \{ dataDir: DATA_DIR, url \}\)/);
  assert.match(hooks[0], /p\.startsWith\('\/api\/voice\/'\) \|\| p\.startsWith\('\/voice\/names\/'\)/);
});

// ─────────────────────────────── the say() queue ───────────────────────────────

/** A hand-cranked clock and a recording player for VoiceQueue. */
function rig(q, { clips = null, loadDelay = 0 } = {}) {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const log = [];
  const playing = new Set();
  const active = [];
  const queue = new q.VoiceQueue({
    now: () => now,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    onActive: (on) => active.push(on),
    load: (item) => {
      const key = item.kind === 'name' ? `name:${item.name}` : item.id;
      const has = clips ? clips.has(key) : true;
      const value = has ? { key } : null;
      if (!loadDelay) return Promise.resolve(value);
      return new Promise((resolve) => { const id = ++seq; timers.set(id, { at: now + loadDelay, fn: () => resolve(value) }); });
    },
    play: (clip, done) => {
      const p = { key: clip.key, done, stopped: false };
      assert.equal(playing.size, 0, `"${clip.key}" started while something else was still playing`);
      playing.add(p);
      log.push(`play ${clip.key}`);
      p.finish = () => { playing.delete(p); log.push(`end ${clip.key}`); done(); };
      return () => { p.stopped = true; playing.delete(p); log.push(`cut ${clip.key}`); };
    },
  });
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const advance = async (ms) => {
    const until = now + ms;
    for (;;) {
      await settle();
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
    await settle();
  };
  const current = () => [...playing][0] || null;
  const finish = async () => { const p = current(); assert.ok(p, 'something is playing'); p.finish(); await settle(); };
  return { queue, log, active, advance, settle, current, finish, timers };
}

test('say queue: lines play one after another, never overlapping, with the gap between', async () => {
  const q = await queueMod();
  const r = rig(q);
  assert.equal(r.queue.say(['m-player-1', 'm-wins-the-match'], { gapMs: 120 }), true);
  assert.equal(r.queue.say('nice-shot'), true);
  await r.settle();
  assert.deepEqual(r.log, ['play m-player-1']);
  await r.finish();
  assert.deepEqual(r.log, ['play m-player-1', 'end m-player-1'], 'nothing starts inside the gap');
  await r.advance(119);
  assert.equal(r.current(), null);
  await r.advance(1);
  assert.equal(r.current().key, 'm-wins-the-match');
  await r.finish();
  await r.advance(120);
  assert.equal(r.current().key, 'nice-shot');
  assert.equal(r.queue.busy, true);
  await r.finish();
  await r.advance(200);
  assert.equal(r.queue.busy, false);
  assert.deepEqual(r.active, [true, false], 'the effects duck once for the whole run and come back at the end');
});

test('say queue: a higher priority clears the queue and cuts in; equal or lower waits its turn', async () => {
  const q = await queueMod();
  const r = rig(q);
  r.queue.say('nice-shot', { priority: 1 });
  r.queue.say('great-shot', { priority: 1 });
  await r.settle();
  assert.equal(r.current().key, 'nice-shot');
  r.queue.say('m-knockout', { priority: 3 });
  await r.settle();
  assert.deepEqual(r.log, ['play nice-shot', 'cut nice-shot', 'play m-knockout']);
  r.queue.say('m-sudden-death', { priority: 3 });   // equal: waits
  r.queue.say('so-close', { priority: 1 });         // lower: waits
  await r.settle();
  assert.equal(r.current().key, 'm-knockout');
  assert.equal(r.queue.pending, 2);
  await r.finish();
  await r.advance(120);
  assert.equal(r.current().key, 'm-sudden-death');
  await r.finish();
  await r.advance(120);
  assert.equal(r.current().key, 'so-close');
  assert.ok(!r.log.includes('play great-shot'), 'the line that was waiting when the knockout cut in is gone');
});

test('say queue: a player name plays when its clip exists, else the fallback line; a missing line is skipped', async () => {
  const q = await queueMod();
  let r = rig(q, { clips: new Set(['name:Alex', 'm-player-1', 'm-wins-the-match']) });
  r.queue.say([{ name: 'Alex', fallback: 'm-player-1' }, 'm-wins-the-match']);
  await r.settle();
  assert.equal(r.current().key, 'name:Alex');

  r = rig(q, { clips: new Set(['m-player-1', 'm-wins-the-match']) });
  r.queue.say([{ name: 'Zed', fallback: 'm-player-1' }, 'm-wins-the-match']);
  await r.settle();
  assert.equal(r.current().key, 'm-player-1');
  await r.finish();
  await r.advance(120);
  assert.equal(r.current().key, 'm-wins-the-match');

  r = rig(q, { clips: new Set(['m-wins-the-match']) });
  r.queue.say([{ name: 'Zed' }, 'no-such-line', 'm-wins-the-match']);
  await r.settle();
  assert.deepEqual(r.log, ['play m-wins-the-match'], 'missing clips cost no time');

  r = rig(q, { clips: new Set() });
  assert.equal(r.queue.say('no-such-line'), true);
  await r.settle();
  assert.equal(r.queue.busy, false);
  assert.deepEqual(r.active, [], 'nothing spoke, nothing ducked');
});

test('say queue: stale sentences are dropped, slow clips are skipped, stop() silences and flushes', async () => {
  const q = await queueMod();
  let r = rig(q);
  r.queue.say('nice-shot');
  r.queue.say('great-shot', { maxWaitMs: 1000 });
  r.queue.say('perfect', { maxWaitMs: 60000 });
  await r.settle();
  await r.advance(5000);            // nice-shot is a very long clip
  await r.finish();
  await r.advance(120);
  assert.equal(r.current().key, 'perfect', 'great-shot waited too long and was dropped');

  r = rig(q, { loadDelay: 5000 });  // a clip that takes five seconds to arrive
  r.queue.say(['nice-shot']);
  await r.advance(1600);
  assert.equal(r.queue.busy, false, 'given up after the load timeout');
  assert.deepEqual(r.log, []);

  r = rig(q);
  r.queue.say('nice-shot');
  r.queue.say('great-shot');
  await r.settle();
  r.queue.stop();
  assert.deepEqual(r.log, ['play nice-shot', 'cut nice-shot']);
  assert.equal(r.queue.busy, false);
  await r.advance(5000);
  assert.deepEqual(r.log, ['play nice-shot', 'cut nice-shot'], 'nothing queued speaks after stop()');
  assert.deepEqual(r.active, [true, false]);
  assert.equal(r.queue.say('perfect'), true, 'and it works again afterwards');
  await r.settle();
  assert.equal(r.current().key, 'perfect');
});

test('say queue: bad input is a no-op, and the queue has a ceiling', async () => {
  const q = await queueMod();
  const r = rig(q);
  for (const bad of [null, undefined, '', [], [null, 42, {}], { nope: 1 }, 7]) assert.equal(r.queue.say(bad), false);
  assert.equal(r.queue.busy, false);
  assert.deepEqual(q.normaliseLine(['a', { name: ' Bob ', fallback: 'm-player-1' }, { fallback: 'b' }, { id: 'c' }, {}, 3]), [
    { kind: 'line', id: 'a' }, { kind: 'name', name: 'Bob', fallback: 'm-player-1' }, { kind: 'line', id: 'b' }, { kind: 'line', id: 'c' },
  ]);
  let accepted = 0;
  for (let i = 0; i < 30; i++) if (r.queue.say('nice-shot')) accepted++;
  assert.ok(accepted <= 10, `a flood is capped (${accepted} accepted)`);
  const thrower = new q.VoiceQueue({ load: () => { throw new Error('boom'); }, play: () => { throw new Error('bang'); } });
  assert.doesNotThrow(() => thrower.say('x'));
  assert.doesNotThrow(() => thrower.stop());
  assert.equal(new q.VoiceQueue({}).say('x'), false);
});

test('takes: random, never the same take twice running; the pack comes from ?voice=', async () => {
  const q = await queueMod();
  assert.equal(q.pickTake(0), -1);
  assert.equal(q.pickTake(1, 0), 0);
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const n of [2, 3]) {
    let last = -1;
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const k = q.pickTake(n, last, random);
      assert.ok(k >= 0 && k < n);
      assert.notEqual(k, last, 'no immediate repeat');
      seen.add(k);
      last = k;
    }
    assert.equal(seen.size, n, 'every take gets used');
  }
  assert.equal(q.pickTake(3, -1, () => 0.999999), 2);
  assert.equal(q.pickTake(3, 2, () => 0.999999), 1);
  assert.equal(q.pickTake(3, 0, () => 0), 1);

  assert.equal(q.packFromQuery('?voice=arena'), 'arena');
  assert.equal(q.packFromQuery('?sound=1&voice=my-pack2'), 'my-pack2');
  for (const bad of ['', '?voice=', '?voice=../x', '?voice=A', '?voice=a%2Fb', '?x=1', null]) assert.equal(q.packFromQuery(bad), null);
});

// ───────────────────── ArcadeAudio's announcer, under a fake Web Audio ─────────────────────

function fakeWebAudio() {
  const made = { sources: [], gains: [], oscs: [] };
  const param = (value = 0) => ({
    value, calls: [],
    setValueAtTime(v) { this.value = v; this.calls.push(['set', v]); },
    setTargetAtTime(v) { this.target = v; this.calls.push(['target', v]); },
    linearRampToValueAtTime(v) { this.calls.push(['lin', v]); },
    exponentialRampToValueAtTime(v) { this.calls.push(['exp', v]); },
    cancelScheduledValues() {},
  });
  const node = (extra = {}) => ({ to: [], connect(n) { this.to.push(n); return n; }, disconnect() { this.to = []; }, ...extra });
  class Ctx {
    constructor() { this.currentTime = 10; this.state = 'running'; this.sampleRate = 48000; this.destination = node(); Ctx.last = this; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { const g = node({ gain: param(1) }); made.gains.push(g); return g; }
    createWaveShaper() { return node({ curve: null }); }
    createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
    createConvolver() { return node({ buffer: null }); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(), Q: param() }); }
    createOscillator() {
      const o = node({ type: 'sine', frequency: param(), detune: param(), started: null, start(t) { this.started = t; }, stop() {} });
      made.oscs.push(o);
      return o;
    }
    createBuffer(ch, n, sr) { const d = Array.from({ length: ch }, () => new Float32Array(n)); return { duration: n / sr, sampleRate: sr, getChannelData: (c) => d[c] }; }
    createBufferSource() {
      const s = node({ buffer: null, loop: false, playbackRate: param(1), started: null, stopped: null,
        start(t, off, dur) { this.started = { t, off, dur }; }, stop(t) { this.stopped = t; } });
      made.sources.push(s);
      return s;
    }
    decodeAudioData(ab) {
      const [text, seconds] = Buffer.from(ab).toString('utf8').split('|');   // the fake files carry their own name (and length)
      const d = new Float32Array(4800).fill(0.25);
      return Promise.resolve({ name: text, duration: Number(seconds) || 1.25, sampleRate: 48000, getChannelData: () => d });
    }
  }
  return { Ctx, made };
}

/** Install a fake window + fetch serving `files` (url -> body); returns restore(). */
function fakePage(files, { search = '' } = {}) {
  const web = fakeWebAudio();
  const prev = { window: globalThis.window, fetch: globalThis.fetch };
  const requests = [];
  globalThis.window = { AudioContext: web.Ctx, addEventListener() {}, removeEventListener() {}, location: { search } };
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || 'GET', body: init.body });
    const body = typeof files === 'function' ? files(String(url), init) : files[String(url)];
    if (body == null) return { ok: false, status: 404, headers: { get: () => 'text/plain' }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
    const buf = isJson ? Buffer.from(JSON.stringify(body)) : Buffer.from(body);
    return { ok: true, status: 200, headers: { get: () => (isJson ? 'application/json' : 'audio/mpeg') }, json: async () => JSON.parse(buf.toString('utf8')),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
  };
  const restore = () => {
    if (prev.window === undefined) delete globalThis.window; else globalThis.window = prev.window;
    globalThis.fetch = prev.fetch;
  };
  return { ...web, requests, restore };
}
const tick = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const PACK_FILES = {
  '/arcade/voice/announcer/manifest.json': { pack: 'announcer', voice: { id: 'x' }, lines: {
    'nice-shot': { text: 'NICE SHOT!', files: ['nice-shot-1.mp3', 'nice-shot-2.mp3', 'nice-shot-3.mp3'] },
    'm-player-1': { text: 'PLAYER ONE', files: ['m-player-1-1.mp3'] },
    'm-wins-the-match': { text: 'WINS THE MATCH!', files: ['m-wins-the-match-1.mp3'] },
    'm-knockout': { text: 'KNOCKOUT!', files: ['m-knockout-1.mp3'] },
    'gone': { text: 'GONE', files: ['gone-1.mp3'] },
  } },
  '/arcade/voice/announcer/nice-shot-1.mp3': 'nice-shot-1', '/arcade/voice/announcer/nice-shot-2.mp3': 'nice-shot-2',
  '/arcade/voice/announcer/nice-shot-3.mp3': 'nice-shot-3', '/arcade/voice/announcer/m-player-1-1.mp3': 'm-player-1-1',
  '/arcade/voice/announcer/m-wins-the-match-1.mp3': 'm-wins-the-match-1', '/arcade/voice/announcer/m-knockout-1.mp3': 'm-knockout-1',
  '/arcade/sfx/manifest.json': { version: 1, cues: {
    'crowd-roar': { files: ['crowd-roar.mp3', 'crowd-roar-2.mp3'] }, roar: { files: ['crowd-roar.mp3', 'crowd-roar-2.mp3'], alias: 'crowd-roar' },
    whoosh: { files: ['whoosh.mp3'] }, 'fanfare-win': { files: ['fanfare-win.mp3'] },
  } },
  '/arcade/sfx/crowd-roar.mp3': 'crowd-roar', '/arcade/sfx/crowd-roar-2.mp3': 'crowd-roar-2', '/arcade/sfx/whoosh.mp3': 'whoosh',
  '/voice/names/alex.mp3': 'name-alex',
};

test('ArcadeAudio: with no Web Audio every announcer call is a silent no-op', async () => {
  const { ArcadeAudio, CUE_NAMES, SAMPLE_CUE_NAMES, SYNTH_CUE_NAMES, CUE_CATEGORY } = await audioMod();
  const { SFX_CUES, SFX_ALIASES, PHYSICAL_SFX_CUES, FEEL_SFX_CUES } = await lines();
  assert.equal(typeof globalThis.window, 'undefined');
  const a = new ArcadeAudio();
  assert.equal(a.state, 'off');
  assert.equal(a.unlock(), false);
  assert.equal(a.say('nice-shot'), false);
  assert.equal(a.say([{ name: 'Alex', fallback: 'm-player-1' }, 'm-wins-the-match'], { priority: 5 }), false);
  assert.equal(a.moment({ impact: 'cup-drop', crowd: 'crowd-roar', sting: 'jackpot', say: 'hole-in-one' }), false);
  assert.doesNotThrow(() => { a.stopVoice(); a.cue('crowd-roar'); a.cue('strike'); a.preloadVoice(['x']); a.setEnabled(false); a.setEnabled(true); a.crowd(1); a.duck(); a.moment(); a.moment(null); a.dispose(); });
  assert.equal(a.voicePack, 'announcer');
  assert.deepEqual(a.voiceLines, []);
  // every cue anyone can ask for has a place in the mix: the old twenty, the contract's, the new ones
  const old = ['strike', 'bounce', 'splash', 'gasp', 'oooh', 'roar', 'perfect', 'great', 'good', 'ok', 'miss', 'disaster',
    'jackpot', 'rocket', 'armed', 'coins', 'levelup', 'streak', 'slowmo-in', 'slowmo-out'];
  for (const name of [...old, ...NEW_CUES, ...SFX_CUES, ...Object.keys(SFX_ALIASES)]) {
    assert.ok(CUE_NAMES.includes(name), `${name} is a cue`);
    assert.match(CUE_CATEGORY[name], /^(impact|sting|feel|crowd|ui)$/, `${name} has a category`);
  }
  assert.deepEqual([...SYNTH_CUE_NAMES, ...SAMPLE_CUE_NAMES].sort(), [...CUE_NAMES].sort());
  for (const name of [...old, ...PHYSICAL_SFX_CUES, ...FEEL_SFX_CUES]) assert.ok(SYNTH_CUE_NAMES.includes(name), `${name} sounds without a file`);
  for (const name of PHYSICAL_SFX_CUES) assert.equal(CUE_CATEGORY[name], 'impact');
  for (const name of NEW_CUES.filter((n) => /^crowd-|^applause$/.test(n))) assert.equal(CUE_CATEGORY[name], 'crowd');
  for (const name of ['ui-tick', 'ui-confirm', 'ui-back', 'trophy-tick', 'turn-chime']) assert.equal(CUE_CATEGORY[name], 'ui');
});

test('ArcadeAudio.say: speaks through the voice bus, one line at a time, ducking the effects', async (t) => {
  const page = fakePage(PACK_FILES);
  t.after(page.restore);
  const { ArcadeAudio } = await audioMod();
  const a = new ArcadeAudio();
  assert.equal(a.say('nice-shot'), false, 'locked: no-op');
  assert.equal(a.unlock(), true);
  await tick();
  assert.equal(a.state, 'running');
  assert.deepEqual(a.voiceLines.sort(), ['gone', 'm-knockout', 'm-player-1', 'm-wins-the-match', 'nice-shot']);
  assert.ok(page.requests.some((r) => r.url === '/arcade/voice/announcer/nice-shot-1.mp3'), 'the likely lines are fetched up front');
  assert.equal(a._crowdLevel, 0, 'no bed');

  const voiceSources = () => page.made.sources.filter((s) => s.buffer && /-\d$|^name-/.test(s.buffer.name || '') && s.started);
  assert.equal(a.say(['m-player-1', 'm-wins-the-match']), true);
  await tick();
  assert.deepEqual(voiceSources().map((s) => s.buffer.name), ['m-player-1-1']);
  const first = voiceSources()[0];
  assert.equal(first.loop, false, 'never a loop');
  assert.equal(first.to[0].to[0], a._voiceBus, 'the clip goes to the voice bus');
  assert.equal(a._voiceBus.to[0], a._ceiling, 'the voice bus skips the compressor');
  assert.equal(a._sfxDuck.gain.target, 0.6, 'effects are ducked while it speaks');
  assert.equal(a.speaking, true);

  await tick(60);
  assert.equal(voiceSources().length, 1, 'the second line waits for the first to end');
  first.onended();
  await new Promise((r) => setTimeout(r, 160));   // the 120 ms gap
  await tick();
  assert.deepEqual(voiceSources().map((s) => s.buffer.name), ['m-player-1-1', 'm-wins-the-match-1']);
  voiceSources()[1].onended();
  await new Promise((r) => setTimeout(r, 160));
  await tick();
  assert.equal(a.speaking, false);
  assert.equal(a._sfxDuck.gain.target, 1, 'the effects come back');

  // takes rotate: never the same one twice running
  const names = [];
  for (let i = 0; i < 8; i++) {
    a.say('nice-shot');
    await tick();
    const s = voiceSources().at(-1);
    names.push(s.buffer.name);
    s.onended();
    await new Promise((r) => setTimeout(r, 130));
    await tick();
  }
  for (let i = 1; i < names.length; i++) assert.notEqual(names[i], names[i - 1], `takes ${names.join(' ')}`);

  // a missing clip, an unknown line: silent
  assert.doesNotThrow(() => { a.say('gone'); a.say('never-heard-of-it'); });
  await tick();
  assert.equal(a.speaking, false);
  a.dispose();
});

test('ArcadeAudio.say: priority cuts in, player names fall back, muting silences and flushes', async (t) => {
  const page = fakePage(PACK_FILES);
  t.after(page.restore);
  const { ArcadeAudio } = await audioMod();
  const a = new ArcadeAudio();
  a.unlock();
  await tick();
  const started = () => page.made.sources.filter((s) => s.buffer && s.started && typeof s.buffer.name === 'string').map((s) => s.buffer.name);

  a.say('nice-shot');
  a.say('m-wins-the-match');
  await tick();
  const playing = page.made.sources.filter((s) => s.started && /^nice-shot/.test(s.buffer.name)).at(-1);
  a.say('m-knockout', { priority: 3 });
  await tick();
  assert.notEqual(playing.stopped, null, 'the line that was playing is cut off');
  assert.equal(started().at(-1), 'm-knockout-1');
  assert.ok(!started().includes('m-wins-the-match-1'), 'the waiting line was cleared');

  // a known name plays the name clip (trimmed and levelled here); an unknown one the fallback
  a.stopVoice();
  a.say([{ name: 'Alex', fallback: 'm-player-1' }]);
  await tick();
  assert.equal(started().at(-1), 'name-alex');
  const nameSrc = page.made.sources.filter((s) => s.started && s.buffer.name === 'name-alex').at(-1);
  assert.ok(nameSrc.to[0].gain.value > 0 && nameSrc.to[0].gain.value <= 8, 'a level-matching gain');
  a.stopVoice();
  a.say([{ name: 'Nobody Here', fallback: 'm-player-1' }, 'm-wins-the-match']);
  await tick();
  assert.equal(started().at(-1), 'm-player-1-1');
  assert.ok(page.requests.some((r) => r.method === 'POST' && r.url === '/api/voice/name' && JSON.parse(r.body).name === 'Nobody Here'),
    'the missing name is asked for, for next time');

  // mute: the voice stops now and the waiting line never speaks
  const before = started().length;
  a.setEnabled(false);
  assert.equal(a.speaking, false);
  assert.equal(a.say('nice-shot'), false);
  await new Promise((r) => setTimeout(r, 200));
  await tick();
  assert.equal(started().length, before, 'nothing spoke while muted');
  a.setEnabled(true);
  await tick();
  assert.equal(started().length, before, 'and the flushed line does not come back with the sound');
  assert.equal(a.say('nice-shot'), true);
  a.dispose();
});

test('ArcadeAudio: ?voice= picks the pack and an unknown pack falls back to the announcer', async (t) => {
  const files = { ...PACK_FILES, '/arcade/voice/arena/manifest.json': { pack: 'arena', voice: { id: 'y' }, lines: { 'nice-shot': { text: 'NICE SHOT!', files: ['nice-shot-1.mp3'] } } },
    '/arcade/voice/arena/nice-shot-1.mp3': 'arena-nice-shot-1' };
  let page = fakePage(files, { search: '?sound=1&voice=arena' });
  const { ArcadeAudio } = await audioMod();
  let a = new ArcadeAudio();
  assert.equal(a.voicePack, 'arena');
  a.unlock();
  await tick();
  a.say('nice-shot');
  await tick();
  assert.ok(page.made.sources.some((s) => s.started && s.buffer.name === 'arena-nice-shot-1'));
  assert.equal(a._nameUrl('alex'), '/voice/names/arena/alex.mp3');
  a.dispose();
  page.restore();

  page = fakePage(files, { search: '?voice=nope' });
  t.after(page.restore);
  a = new ArcadeAudio();
  assert.equal(a.voicePack, 'nope');
  a.unlock();
  await tick();
  assert.equal(a.voicePack, 'announcer');
  assert.ok(a.voiceLines.includes('m-knockout'));
  assert.equal(new ArcadeAudio({ voice: 'arena' }).voicePack, 'arena');
  assert.equal(new ArcadeAudio({ voice: '../bad' }).voicePack, 'nope', 'a bad option falls through to the page address');
  a.dispose();
});

const sounded = (page) => page.made.sources.filter((s) => s.started).length + page.made.oscs.filter((o) => o.started != null).length;
const samplesStarted = (page, rx) => page.made.sources.filter((s) => s.started && s.buffer && rx.test(s.buffer.name || ''));

test('ArcadeAudio.cue: sampled one-shots with random takes; missing files fall back or stay silent', async (t) => {
  const page = fakePage(PACK_FILES);
  t.after(page.restore);
  const { ArcadeAudio } = await audioMod();
  const a = new ArcadeAudio();
  a.unlock();
  await tick();
  assert.ok(a.loadedSamples.includes('crowd-roar') && a.loadedSamples.includes('whoosh') && a.loadedSamples.includes('roar'));
  assert.equal(page.requests.filter((r) => r.url === '/arcade/sfx/crowd-roar.mp3').length, 1, 'a file shared by an alias is fetched once');
  assert.ok(!page.requests.some((r) => r.method === 'HEAD' && /crowd-|whoosh|ui-tick|cup-drop/.test(r.url)), 'only the original cue names are probed for overrides');

  const ctx = page.Ctx.last;
  a.cue('crowd-roar', { intensity: 1 });
  assert.equal(samplesStarted(page, /^crowd-roar/).length, 1);
  const src = samplesStarted(page, /^crowd-roar/)[0];
  assert.equal(src.loop, false, 'a one-shot');
  assert.equal(src.to[0].to[0].to[0], a._catBus.crowd, 'a crowd sample plays on the crowd bus');
  a.cue('roar');                     // the old cue name, same recording, same moment
  assert.equal(samplesStarted(page, /^crowd-roar/).length, 1, 'roar on top of crowd-roar is not stacked');
  ctx.currentTime += 3;
  const takes = [];
  for (let i = 0; i < 6; i++) {
    a.cue('crowd-roar');
    takes.push(samplesStarted(page, /^crowd-roar/).at(-1).buffer.name);
    ctx.currentTime += 3;
  }
  for (let i = 1; i < takes.length; i++) assert.notEqual(takes[i], takes[i - 1], `takes ${takes.join(' ')}`);

  // not generated and no synthesizer: silent. Not a cue at all: silent. Never a throw.
  let before = sounded(page);
  assert.doesNotThrow(() => { a.cue('crowd-cheer'); a.cue('vs-slam'); a.cue('sting-knockout'); a.cue('no-such-cue'); a.cue(null); });
  assert.equal(sounded(page), before);
  // in the manifest but the file is not there: the borrowed synthesizer plays
  a.cue('fanfare-win');
  assert.ok(sounded(page) > before, 'fanfare-win falls back to the synthesized jackpot');
  assert.equal(samplesStarted(page, /^fanfare/).length, 0);
  // the old synthesized cues and the new stand-ins all sound
  for (const name of ['strike', 'cup-drop', 'flag-clank', 'sand-thud', 'tree-knock', 'lava-sizzle', 'ice-skid', 'rough-rustle',
    'green-thump', 'fairway-bounce', 'water-plunk', 'ui-tick', 'ui-confirm', 'ui-back', 'turn-chime', 'trophy-tick',
    'countdown-beep', 'arm-common', 'arm-rare', 'arm-epic', 'confetti-pop', 'riser', 'heartbeat-hit', 'streak-up',
    'streak-break', 'coin-burst', 'sting-fail', 'fanfare-hole']) {
    ctx.currentTime += 5;
    before = sounded(page);
    a.cue(name);
    assert.ok(sounded(page) > before, `${name} sounds`);
  }
  a.dispose();
});

test('ArcadeAudio mix: a hierarchy of category levels, cooldowns, a voice limit, one crowd reaction and one sting at a time', async (t) => {
  const files = { ...PACK_FILES,
    '/arcade/sfx/manifest.json': { version: 1, cues: {
      'crowd-roar': { files: ['crowd-roar.mp3', 'crowd-roar-2.mp3'] }, 'crowd-aww': { files: ['crowd-aww.mp3'] },
      'cup-drop': { files: ['cup-drop.mp3', 'cup-drop-2.mp3'] }, 'fanfare-hole': { files: ['fanfare-hole.mp3'] }, 'ui-tick': { files: ['ui-tick.mp3'] } } },
    '/arcade/sfx/crowd-aww.mp3': 'crowd-aww', '/arcade/sfx/cup-drop.mp3': 'cup-drop', '/arcade/sfx/cup-drop-2.mp3': 'cup-drop-2',
    '/arcade/sfx/fanfare-hole.mp3': 'fanfare-hole', '/arcade/sfx/ui-tick.mp3': 'ui-tick' };
  const page = fakePage(files);
  t.after(page.restore);
  const { ArcadeAudio } = await audioMod();
  const a = new ArcadeAudio();
  a.unlock();
  await tick();
  const ctx = page.Ctx.last;
  const g = (cat) => a._catBus[cat].gain.value;

  // the hierarchy: the announcer is on its own bus above all of it; then impact > sting > feel > crowd > world > ui
  assert.ok(g('impact') > g('sting') && g('sting') > g('feel') && g('feel') > g('crowd') && g('crowd') > g('world') && g('world') > g('ui'));
  for (const cat of ['impact', 'sting', 'feel', 'crowd', 'world', 'ui']) assert.equal(a._catBus[cat].to[0], a._cueBus);
  assert.equal(a._cueBus.to[0], a._sfxDuck, 'every category ducks under the voice');
  assert.equal(a._voiceBus.to[0], a._ceiling);

  // cooldown: the same cue cannot machine-gun
  for (let i = 0; i < 8; i++) a.cue('ui-tick');
  assert.equal(samplesStarted(page, /^ui-tick/).length, 1);
  ctx.currentTime += 0.02;
  a.cue('ui-tick');
  assert.equal(samplesStarted(page, /^ui-tick/).length, 1, 'still inside its cooldown');
  ctx.currentTime += 0.02;
  a.cue('ui-tick');
  assert.equal(samplesStarted(page, /^ui-tick/).length, 2, 'and free again after it');
  a.cue('cup-drop');
  ctx.currentTime += 0.3;
  a.cue('cup-drop');
  assert.equal(samplesStarted(page, /^cup-drop/).length, 1, 'the cup drops once');

  // a voice limit per category: five different interface sounds at once, three play
  ctx.currentTime += 10;
  const live = (cat) => [...a._live].filter((r) => r.cat === cat && (!r.end || r.end > ctx.currentTime)).length;
  for (const name of ['ui-tick', 'ui-confirm', 'ui-back', 'turn-chime', 'trophy-tick']) a.cue(name);
  assert.equal(live('ui'), 3);
  ctx.currentTime += 10;
  assert.equal(a._liveCount('ui').n, 0, 'voices that have run out are forgotten');

  // one crowd reaction at a time: a roar replaces a gasp, an aww does not replace a roar
  a.cue('gasp');
  const gasp = a._held.crowd.rec;
  assert.equal(a._held.crowd.rank, 1);
  ctx.currentTime += 0.3;
  a.cue('crowd-roar');
  assert.equal(a._held.crowd.rank, 3);
  assert.ok(gasp.end <= ctx.currentTime + 0.13, 'the gasp is faded out as the roar takes over');
  ctx.currentTime += 0.3;
  a.cue('crowd-aww');
  assert.equal(samplesStarted(page, /^crowd-aww/).length, 0, 'a smaller reaction does not talk over the roar');
  ctx.currentTime += 1.3;
  a.cue('crowd-aww');
  assert.equal(samplesStarted(page, /^crowd-aww/).length, 1, 'after the window the crowd may react again');

  // one outcome sting at a time
  ctx.currentTime += 5;
  a.cue('good');
  ctx.currentTime += 0.1;
  let before = sounded(page);
  a.cue('jackpot');
  assert.ok(sounded(page) > before && a._held.sting.rank === 3, 'the jackpot replaces the smaller sting');
  ctx.currentTime += 0.1;
  before = sounded(page);
  a.cue('great');
  assert.equal(sounded(page), before, 'and a smaller sting is dropped behind it');

  // physical samples are never copy-pasted: pitch and level move a little; music never detunes
  const rates = new Set();
  const gains = new Set();
  for (let i = 0; i < 12; i++) {
    ctx.currentTime += 2;
    a.cue('cup-drop', { intensity: 0.7 });
    const s = samplesStarted(page, /^cup-drop/).at(-1);
    assert.ok(s.playbackRate.value >= 0.95 && s.playbackRate.value <= 1.05);
    rates.add(s.playbackRate.value);
    gains.add(s.to[0].gain.value);
  }
  assert.ok(rates.size > 6 && gains.size > 6, 'each take is a little different');
  ctx.currentTime += 5;
  a.cue('fanfare-hole');
  assert.equal(samplesStarted(page, /^fanfare-hole/).at(-1).playbackRate.value, 1, 'a fanfare plays at pitch');
  const tickRate = samplesStarted(page, /^ui-tick/).at(-1).playbackRate.value;
  assert.ok(tickRate >= 0.94 && tickRate <= 1.06, 'a hover tick moves a little in pitch, so a run of them rolls');

  // muting fades out whatever is sounding and forgets it
  a.cue('strike');
  assert.ok(a._live.size > 0);
  a.setEnabled(false);
  assert.equal(a._live.size, 0);
  a.dispose();
});

test('ArcadeAudio.moment: one impact, one sting, one crowd reaction, one line, in that order; OK shots get the impact only', async (t) => {
  const files = { ...PACK_FILES,
    '/arcade/sfx/manifest.json': { version: 1, cues: { 'crowd-roar': { files: ['crowd-roar.mp3'] }, applause: { files: ['applause.mp3'] },
      'cup-drop': { files: ['cup-drop.mp3'] }, 'sand-thud': { files: ['sand-thud.mp3'] }, 'crowd-aww': { files: ['crowd-aww.mp3'] } } },
    '/arcade/sfx/cup-drop.mp3': 'cup-drop', '/arcade/sfx/applause.mp3': 'applause', '/arcade/sfx/sand-thud.mp3': 'sand-thud', '/arcade/sfx/crowd-aww.mp3': 'crowd-aww' };
  const page = fakePage(files);
  t.after(page.restore);
  const { ArcadeAudio } = await audioMod();
  const a = new ArcadeAudio();
  a.unlock();
  await tick();
  const ctx = page.Ctx.last;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const step = async (ms) => { t.mock.timers.tick(ms); ctx.currentTime += ms / 1000; await tick(8); };
  const heard = () => page.made.sources.filter((s) => s.started && s.buffer && typeof s.buffer.name === 'string').map((s) => s.buffer.name);
  const oscs = () => page.made.oscs.filter((o) => o.started != null).length;

  assert.equal(a.moment({ impact: 'cup-drop', sting: 'jackpot', crowd: ['crowd-roar', 'applause'], say: 'm-knockout', intensity: 1 }), true);
  await tick(8);
  assert.deepEqual(heard(), ['cup-drop'], 'the impact is now, alone');
  const o0 = oscs();
  await step(79);
  assert.equal(oscs(), o0);
  await step(1);
  assert.ok(oscs() > o0, 'the sting 80 ms after the impact');
  await step(99);
  assert.deepEqual(heard(), ['cup-drop']);
  await step(1);
  assert.deepEqual(heard(), ['cup-drop', 'crowd-roar'], 'the crowd 180 ms after the impact: one reaction, not two');
  await step(379);
  assert.deepEqual(heard(), ['cup-drop', 'crowd-roar'], 'the announcer waits for the crowd\'s attack');
  await step(1);
  assert.deepEqual(heard(), ['cup-drop', 'crowd-roar', 'm-knockout-1'], 'then the line');
  assert.equal(a._momentTimers.size, 0);
  a.stopVoice();

  // an ordinary shot: the physical sound and nothing else, however much the caller passes
  await step(3000);
  let n = heard().length;
  const o1 = oscs();
  assert.equal(a.moment({ impact: 'sand-thud', sting: 'good', crowd: 'applause', say: 'nice-shot', grade: 'OK' }), true);
  await step(2000);
  assert.deepEqual(heard().slice(n), ['sand-thud']);
  assert.equal(oscs(), o1);

  // two moments on top of each other (the HUD's callout, then the match screen's): still one
  // crowd reaction, and the lines take turns (here the second has the higher priority and cuts in)
  await step(3000);
  n = heard().length;
  a.moment({ impact: 'cup-drop', crowd: 'crowd-roar', say: 'nice-shot' });
  await step(100);
  a.moment({ impact: { name: 'sand-thud', intensity: 0.4 }, crowd: 'crowd-aww', say: { line: 'm-wins-the-match', priority: 2 } });
  await step(470);                    // the first moment's line is due 560 ms after it began
  assert.match(heard().at(-1), /^nice-shot-[123]$/);
  await step(2000);
  const both = heard().slice(n);
  assert.deepEqual(both.slice(0, 3), ['cup-drop', 'sand-thud', 'crowd-roar']);
  assert.ok(!both.includes('crowd-aww'), 'the smaller crowd reaction is dropped behind the roar');
  assert.match(both[3], /^nice-shot-[123]$/);
  assert.equal(both[4], 'm-wins-the-match-1');
  assert.equal(both.length, 5);
  assert.notEqual(page.made.sources.filter((x) => x.started && /^nice-shot/.test(x.buffer.name || '')).at(-1).stopped, null, 'the higher priority line cut in');
  a.stopVoice();

  // muting, or stopVoice(), in the middle of a moment: the rest never plays
  await step(3000);
  n = heard().length;
  a.moment({ impact: 'cup-drop', crowd: 'crowd-roar', say: 'nice-shot' });
  await step(50);
  a.setEnabled(false);
  await step(2000);
  assert.deepEqual(heard().slice(n), ['cup-drop']);
  assert.equal(a.moment({ impact: 'cup-drop' }), false, 'muted: a no-op');
  a.setEnabled(true);

  // only a line: spoken at once; nothing at all: nothing, no throw
  await step(3000);
  n = heard().length;
  a.moment({ say: ['m-player-1', 'm-wins-the-match'] });
  await tick(8);
  assert.deepEqual(heard().slice(n), ['m-player-1-1']);
  assert.doesNotThrow(() => { a.moment({}); a.moment({ impact: 42, crowd: {}, sting: [], say: '' }); });
  a.dispose();
});

// ───────────────────── anticipation, then payoff ─────────────────────

const antMod = () => import('../public/arcade/voice/anticipation.js');

const SWELL_FILES = { ...PACK_FILES,
  '/arcade/sfx/manifest.json': { version: 2, cues: {
    'crowd-rise-1s': { files: ['crowd-rise-1s.mp3', 'crowd-rise-1s-2.mp3'], peakS: 1.2 },
    'crowd-rise-2s': { files: ['crowd-rise-2s.mp3'], peakS: 2 },
    'crowd-rise-3s': { files: ['crowd-rise-3s.mp3'], peakS: 3 },
    'crowd-rise-4s': { files: ['crowd-rise-4s.mp3'], peakS: 4.5 },
    'crowd-roar': { files: ['crowd-roar.mp3'] }, roar: { files: ['crowd-roar.mp3'], alias: 'crowd-roar' },
    'crowd-ohh': { files: ['crowd-ohh.mp3'] }, 'crowd-cheer': { files: ['crowd-cheer.mp3'] }, applause: { files: ['applause.mp3'] },
    'cup-drop': { files: ['cup-drop.mp3'] },
    strike: { files: ['strike.mp3', 'strike-2.mp3'], hard: ['strike-hard.mp3'] },
    'stage-sting': { files: ['stage-sting.mp3'] }, 'stage-sting-volcano': { files: ['stage-sting-volcano.mp3'] },
    'select-stage': { files: ['select-stage.mp3'] }, 'vs-slam': { files: ['vs-slam.mp3'] }, 'start-match': { files: ['start-match.mp3'] },
  } },
  '/arcade/sfx/crowd-rise-1s.mp3': 'crowd-rise-1s|1.65', '/arcade/sfx/crowd-rise-1s-2.mp3': 'crowd-rise-1s-2|1.65',
  '/arcade/sfx/crowd-rise-2s.mp3': 'crowd-rise-2s|2.45', '/arcade/sfx/crowd-rise-3s.mp3': 'crowd-rise-3s|3.45',
  '/arcade/sfx/crowd-rise-4s.mp3': 'crowd-rise-4s|4.95', '/arcade/sfx/crowd-ohh.mp3': 'crowd-ohh|2.3', '/arcade/sfx/crowd-cheer.mp3': 'crowd-cheer|2.6',
  '/arcade/sfx/applause.mp3': 'applause|3', '/arcade/sfx/cup-drop.mp3': 'cup-drop|1.1',
  '/arcade/sfx/strike.mp3': 'strike|0.4', '/arcade/sfx/strike-2.mp3': 'strike-2|0.4', '/arcade/sfx/strike-hard.mp3': 'strike-hard|0.6',
  '/arcade/sfx/stage-sting.mp3': 'stage-sting|1.8', '/arcade/sfx/stage-sting-volcano.mp3': 'stage-sting-volcano|1.8',
  '/arcade/sfx/select-stage.mp3': 'select-stage|0.2', '/arcade/sfx/vs-slam.mp3': 'vs-slam|1.3', '/arcade/sfx/start-match.mp3': 'start-match|0.8',
};

test('planSwell: the swell that fits the window, timed so its peak lands on the moment, never stretched', async () => {
  const { planSwell, DECODE_LEAD_S } = await antMod();
  const L = [1.2, 2, 3, 4.5];
  const lands = (p, seconds) => Math.abs(p.startIn - p.offset + L[p.index] + DECODE_LEAD_S - seconds) < 1e-9;
  // a window shorter than the shortest swell: enter part-way up its rise
  let p = planSwell(L, 0.8);
  assert.equal(p.index, 0);
  assert.ok(p.offset > 0.4 && p.startIn < 0.01 && lands(p, 0.8));
  // the longest that fits, started late
  for (const [seconds, index] of [[1.5, 0], [2.5, 1], [4, 2], [4.6, 3], [10, 3], [1.23, 0], [2.03, 1]]) {
    p = planSwell(L, seconds);
    assert.equal(p.index, index, `${seconds} s takes the ${L[index]} s swell`);
    assert.equal(p.offset, 0);
    assert.ok(p.startIn >= 0.005 && lands(p, seconds), `the peak lands at ${seconds} s`);
  }
  assert.ok(planSwell(L, 10).startIn > 5.4, 'a long window starts the swell late');
  assert.equal(planSwell([3, 1.2, 4.5, 2], 2.5).index, 3, 'whatever order the takes come in');
  assert.equal(planSwell([], 2), null);
  assert.equal(planSwell([0, 2], 2), null);
  assert.ok(lands(planSwell(L, 0), 0.2), 'a window of nothing is treated as a fifth of a second');
});

test('planAnticipation: a swell into the drop, into the lip-out, into applause; nothing for a ball nowhere near', async () => {
  const { planAnticipation } = await antMod();
  const far = [{ x: 0, y: 0 }, { x: 0, y: 40 }];
  // holing: the swell runs from the start of the slow motion to the drop
  assert.deepEqual(planAnticipation({ slowmo: [{ t0: 0, t1: 0.08, reason: 'strike' }, { t0: 3, t1: 6.6, rate: 0.4, reason: 'holing' }], cupDropT: 6, playS: 6.6, points: far }, { holed: true }), [
    { at: 3, do: 'anticipate', seconds: 3 }, { at: 6, do: 'resolve', outcome: 'in' }]);
  // it flies straight in: no time to rise, the payoff alone
  assert.deepEqual(planAnticipation({ slowmo: [{ t0: 5.9, t1: 6.5, reason: 'holing' }], cupDropT: 6, playS: 6.5 }, { holed: true }), [{ at: 6, do: 'resolve', outcome: 'in' }]);
  assert.deepEqual(planAnticipation({ slowmo: [], cupDropT: 2 }, { holed: true }), [{ at: 2, do: 'resolve', outcome: 'in' }]);
  // a lip-out: the swell peaks as the ball reaches the cup, the groan just after it has passed
  const lip = planAnticipation({ slowmo: [{ t0: 4, t1: 6.3, rate: 0.5, reason: 'lip' }], playS: 8, points: far }, { holed: false, distToPinYd: 0.6 });
  assert.equal(lip.length, 2);
  assert.equal(lip[0].do, 'anticipate');
  assert.equal(lip[0].at, 4);
  assert.ok(Math.abs(lip[0].seconds - 1.4) < 0.001);
  assert.deepEqual([lip[1].do, lip[1].outcome], ['resolve', 'out']);
  assert.ok(Math.abs(lip[1].at - 5.5) < 0.001 && lip[1].at <= 6.3);
  // no slow motion, but it stops inside two and a half feet: a short swell into applause
  assert.deepEqual(planAnticipation({ slowmo: [], playS: 5, points: far }, { holed: false, distToPinYd: 0.5 }), [
    { at: 3.7, do: 'anticipate', seconds: 1.25 }, { at: 4.95, do: 'resolve', outcome: 'close' }]);
  // nothing: far from the hole, a tap-in, a ball already holed with no drop time, no sim at all
  assert.deepEqual(planAnticipation({ slowmo: [], playS: 7, points: far }, { holed: false, distToPinYd: 12 }), []);
  assert.deepEqual(planAnticipation({ slowmo: [], playS: 2, points: [{ x: 0, y: 0 }, { x: 0, y: 0.6 }] }, { holed: false, distToPinYd: 0.3 }), []);
  assert.deepEqual(planAnticipation({ slowmo: [], playS: 1, points: far }, { holed: false, distToPinYd: 0.3 }), []);
  assert.deepEqual(planAnticipation(null), []);
  assert.deepEqual(planAnticipation({}), []);
});

test('ArcadeAudio.anticipate / resolve: the peak lands on the moment, resolve cuts and fires, the crowd never doubles', async (t) => {
  const page = fakePage(SWELL_FILES);
  t.after(page.restore);
  const { ArcadeAudio } = await audioMod();
  const a = new ArcadeAudio();
  assert.equal(a.anticipate({ seconds: 2 }), null, 'locked: nothing');
  assert.equal(a.resolve('in'), false);
  a.unlock();
  await tick();
  const ctx = page.Ctx.last;
  const started = (rx) => page.made.sources.filter((s) => s.started && s.buffer && rx.test(s.buffer.name || ''));
  const PEAK = { 'crowd-rise-1s': 1.2, 'crowd-rise-1s-2': 1.2, 'crowd-rise-2s': 2, 'crowd-rise-3s': 3, 'crowd-rise-4s': 4.5 };

  // windows of 0.8, 1.5, 2.5 and 4 s: the peak of the chosen swell lands at the end of each
  for (const [seconds, cue] of [[0.8, 'crowd-rise-1s'], [1.5, 'crowd-rise-1s'], [2.5, 'crowd-rise-2s'], [4, 'crowd-rise-3s'], [9, 'crowd-rise-4s']]) {
    ctx.currentTime += 20;
    const now = ctx.currentTime;
    const h = a.anticipate({ seconds, intensity: 0.9 });
    assert.equal(h.cue, cue, `${seconds} s plays ${cue}`);
    assert.ok(Math.abs(h.endsAt - (now + seconds)) < 1e-9);
    const src = started(/^crowd-rise/).at(-1);
    assert.ok(src.buffer.name.startsWith(cue));
    const peakAt = src.started.t - src.started.off + PEAK[src.buffer.name] + 0.025;
    assert.ok(Math.abs(peakAt - (now + seconds)) < 1e-6, `${seconds} s: the peak lands at the end of the window (${(peakAt - now).toFixed(4)})`);
    assert.ok(src.started.t >= now, 'never started in the past');
    assert.equal(src.loop, false, 'one shaped one-shot, never a loop');
    assert.equal(src.to[0].to[0], a._catBus.crowd, 'on the crowd bus');
    if (seconds < 1.2) assert.ok(src.started.off > 0.4, 'a short window enters part-way up the rise'); else assert.equal(src.started.off, 0);
    h.cancel();
    assert.notEqual(src.stopped, null);
  }

  // while it rises it is the only crowd sound; everything else still plays
  ctx.currentTime += 20;
  a.cue('crowd-cheer');
  const cheer = started(/^crowd-cheer/).at(-1);
  ctx.currentTime += 0.2;
  let now = ctx.currentTime;
  a.anticipate({ seconds: 2.5 });
  const swell = started(/^crowd-rise/).at(-1);
  assert.equal(cheer.to[0].to[0].gain.target, 0, 'a crowd sound that was playing gives way to the swell');
  ctx.currentTime += 1;
  const before = started(/^crowd-(cheer|roar|ohh)|^applause/).length;
  a.cue('crowd-cheer'); a.cue('roar'); a.cue('applause');
  assert.equal(started(/^crowd-(cheer|roar|ohh)|^applause/).length, before, 'no other crowd cue starts during the swell');
  a.cue('strike');
  assert.equal(started(/^strike/).length, 1, 'the ball is still heard');

  // the payoff: the swell is cut in 60 ms and the roar and the cup land on this frame
  ctx.currentTime = now + 2.5;
  now = ctx.currentTime;
  assert.equal(a.resolve('in'), true);
  assert.ok(Math.abs(swell.stopped - (now + 0.08)) < 1e-6, 'the swell is cut with a 60 ms fade');
  assert.equal(swell.to[0].gain.target, 0);
  assert.equal(started(/^cup-drop/).length, 1);
  assert.equal(started(/^crowd-roar/).length, 1);
  assert.equal(a._swell, null);
  // the HUD's own crowd reaction to the same shot, a moment later and a second later: dropped
  a.cue('crowd-roar'); a.cue('roar'); a.cue('cup-drop');   // the same frame: the cup has already rattled
  ctx.currentTime += 1.5;
  a.cue('crowd-roar', { intensity: 1 }); a.cue('crowd-cheer');
  assert.equal(started(/^crowd-roar/).length, 1, 'one roar for one holed ball');
  assert.equal(started(/^crowd-cheer/).length, 1);
  assert.equal(started(/^cup-drop/).length, 1);
  ctx.currentTime += 4;
  a.cue('crowd-cheer');
  assert.equal(started(/^crowd-cheer/).length, 2, 'and the crowd is free again afterwards');

  // the HUD fired its roar a hair BEFORE the payoff: the payoff takes over, the first fades
  ctx.currentTime += 20;
  a.cue('roar');
  const early = a._held.crowd.rec;
  ctx.currentTime += 0.004;
  assert.equal(a.resolve('in'), true);
  assert.ok(early.end <= ctx.currentTime + 0.13);
  assert.equal(a._held.crowd.rank, 9, 'nothing outranks the payoff');

  // out: the groan. close: applause. Both without a swell having played. Unknown: nothing.
  ctx.currentTime += 20;
  assert.equal(a.resolve('out'), true);
  assert.equal(started(/^crowd-ohh/).length, 1);
  a.cue('crowd-ohh');
  assert.equal(started(/^crowd-ohh/).length, 1, 'the HUD\'s so-close groan is the duplicate');
  ctx.currentTime += 20;
  assert.equal(a.resolve('close'), true);
  assert.equal(started(/^applause/).length, 1);
  assert.equal(a.resolve('sideways'), false);
  assert.equal(a.resolve(), false);

  // one swell at a time; nobody resolves: it ends by itself and the crowd is released
  ctx.currentTime += 20;
  a.anticipate({ seconds: 3.2 });
  const first = started(/^crowd-rise/).at(-1);
  a.anticipate({ seconds: 1.3 });
  const second = started(/^crowd-rise/).at(-1);
  assert.notEqual(first, second);
  assert.notEqual(first.stopped, null, 'a new swell cuts the old one');
  assert.equal(second.stopped, null);
  ctx.currentTime += 1.3 + 0.45;
  second.onended();
  assert.equal(a._swell, null);
  a.cue('crowd-cheer');
  assert.equal(started(/^crowd-cheer/).length, 3);

  // muting cuts a swell; muted or bad input is a quiet no-op
  ctx.currentTime += 20;
  a.anticipate({ seconds: 2 });
  const third = started(/^crowd-rise/).at(-1);
  a.setEnabled(false);
  assert.notEqual(third.stopped, null);
  assert.equal(a.anticipate({ seconds: 2 }), null);
  assert.equal(a.resolve('in'), false);
  a.setEnabled(true);
  assert.doesNotThrow(() => { a.anticipate(); a.anticipate(null); a.anticipate({ seconds: 'x' }); a.resolve('in', null); });
  a.dispose();
});

test('ArcadeAudio: without swell files anticipate is a no-op and the payoff still fires', async (t) => {
  const page = fakePage(PACK_FILES);
  t.after(page.restore);
  const { ArcadeAudio } = await audioMod();
  const a = new ArcadeAudio();
  a.unlock();
  await tick();
  assert.equal(a.anticipate({ seconds: 2 }), null);
  assert.equal(a.resolve('in'), true);
  assert.equal(page.made.sources.filter((s) => s.started && /^crowd-roar/.test(s.buffer.name || '')).length, 1);
  a.dispose();
});

test('ArcadeAudio: the setup flow cues, hard takes for hard hits, and a stage\'s own sting', async (t) => {
  const page = fakePage(SWELL_FILES);
  t.after(page.restore);
  const { ArcadeAudio, CUE_CATEGORY, CUE_NAMES } = await audioMod();
  for (const [name, cat] of Object.entries({ 'lobby-open': 'feel', 'ui-tick': 'ui', 'select-player': 'ui', 'select-format': 'ui', 'select-stage': 'ui',
    'toggle-on': 'ui', 'toggle-off': 'ui', 'drawer-open': 'ui', 'drawer-close': 'ui', 'ui-back': 'ui', 'ui-error': 'ui', 'start-match': 'sting',
    'vs-slam': 'sting', 'coin-flip': 'feel', 'coin-land': 'sting', 'stage-sting': 'sting', 'tee-off': 'feel', whoosh: 'feel' })) {
    assert.equal(CUE_CATEGORY[name], cat, `${name} is mixed as ${cat}`);
    assert.ok(CUE_NAMES.includes(name));
  }
  const a = new ArcadeAudio();
  a.unlock();
  await tick();
  const ctx = page.Ctx.last;
  const names = () => page.made.sources.filter((s) => s.started && s.buffer && typeof s.buffer.name === 'string').map((s) => s.buffer.name);

  // a wedge and a driver: the same cue, different takes
  for (let i = 0; i < 6; i++) { ctx.currentTime += 1; a.cue('strike', { intensity: 0.5 }); }
  assert.ok(names().every((n) => n === 'strike' || n === 'strike-2'), 'ordinary takes for ordinary hits');
  for (let i = 0; i < 3; i++) { ctx.currentTime += 1; a.cue('strike', { intensity: 0.95 }); }
  assert.deepEqual(names().slice(-3), ['strike-hard', 'strike-hard', 'strike-hard'], 'the heavy take when the ball leaves fast');

  // a stage with its own sting plays it; any other stage gets the generic one
  ctx.currentTime += 5;
  a.cue('stage-sting-volcano');
  assert.equal(names().at(-1), 'stage-sting-volcano');
  ctx.currentTime += 5;
  a.cue('stage-sting-alpine');
  assert.equal(names().at(-1), 'stage-sting');
  ctx.currentTime += 5;
  const n = names().length;
  a.cue('stage-sting-<bad>'); a.cue('stage-sting-');
  assert.equal(names().length, n);

  // START hands off to the VS slam: the slam outranks it and takes over; a pick is one sound
  ctx.currentTime += 5;
  a.cue('start-match');
  ctx.currentTime += 0.4;
  a.cue('vs-slam');
  assert.deepEqual(names().slice(-2), ['start-match', 'vs-slam']);
  assert.equal(a._held.sting.rank, 3);
  ctx.currentTime += 5;
  a.cue('select-stage'); a.cue('select-stage');
  assert.equal(names().filter((x) => x === 'select-stage').length, 1, 'a double-fired pick still sounds once');
  // twenty hover ticks in a fast run all sound (the cooldown is short), with no file they fall back to the synth
  let before = page.made.oscs.filter((o) => o.started != null).length;
  for (let i = 0; i < 20; i++) { ctx.currentTime += 0.05; a.cue('ui-tick'); }
  assert.ok(page.made.oscs.filter((o) => o.started != null).length >= before + 20);
  a.dispose();
});

test('levelNameClip: skips the silence round a name and matches its level to the pack', async () => {
  const { levelNameClip } = await audioMod();
  const sr = 48000;
  const d = new Float32Array(sr * 2);
  for (let i = sr * 0.5; i < sr * 1.2; i++) d[i] = 0.05 * Math.sin((2 * Math.PI * 200 * i) / sr);
  const clip = levelNameClip({ sampleRate: sr, duration: 2, getChannelData: () => d });
  assert.ok(Math.abs(clip.offset - 0.495) < 0.01, `starts at the voice (${clip.offset})`);
  assert.ok(clip.duration > 0.7 && clip.duration < 0.8, `ends after it (${clip.duration})`);
  assert.ok(clip.gain > 3 && clip.gain <= 8, `quiet clip is brought up (${clip.gain})`);
  assert.ok(0.05 * clip.gain <= 0.8, 'never past the peak ceiling');
  const silent = levelNameClip({ sampleRate: sr, duration: 1, getChannelData: () => new Float32Array(sr) });
  assert.deepEqual([silent.offset, silent.duration, silent.gain], [0, 1, 1]);
});
