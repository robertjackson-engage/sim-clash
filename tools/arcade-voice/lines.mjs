// The announcer's line catalogue: every line the game can ask for with audio.say(id).
//
// Ids and texts are fixed by docs/dev/arcade-v2-contract.md (section 2: shot callouts,
// section 3: match lines, section 1: the twelve stages, section 5: the eighteen power-ups).
// `text` is what the banner shows and what the manifest records. `takes` is what the voice
// is actually asked to say, once per take: eleven_v3 honours delivery tags in [brackets],
// capitals are emphasis, a stretched vowel is a stretched shout, and an extra "!" is more
// volume. Keep each take to the words of the line: the HUD shows `text`, and a take that
// says something else is a bug you can only find by listening.
//
// To add a line: add it here (two or three takes), run
//   node tools/arcade-voice/generate.mjs voice --only <id>
// and `node --test test/arcade-voice.test.js` (the test pins the contract's id sets).

export const PACKS = {
  // The big arcade sports announcer: loud, punchy, grinning.
  announcer: {
    voiceId: '0m1WGWVzxS7KbWobXtnw',     // "Olumide", an American sports commentator
    voiceName: 'Olumide',
    model: 'eleven_v3',
    // v3 is touchy about stability: lower is more acted (and more likely to wander),
    // below about 0.30 it stops sounding like a person.
    // (four settings known to work with this model)
    settings: { stability: 0.35, similarity_boost: 0.8, use_speaker_boost: true, speed: 1.0 },
    nameDelivery: '[shouting] {NAME}!',
    // if the voice id is not on the account: the closest energetic male announcer
    want: { gender: 'male', words: ['sport', 'commentat', 'announcer', 'energetic', 'hype', 'excited', 'american'] },
  },
  // The deep cinematic one, for choosing by ear: ?voice=arena
  arena: {
    voiceId: 'zfWx5IjUaWGWTId9hv9t',     // "Atlas"
    voiceName: 'Atlas',
    model: 'eleven_v3',
    settings: { stability: 0.4, similarity_boost: 0.8, use_speaker_boost: true, speed: 1.0 },
    nameDelivery: '[booming, shouting] {NAME}!',
    want: { gender: 'male', words: ['deep', 'cinematic', 'trailer', 'epic', 'announcer', 'booming', 'narrat'] },
  },
};

const line = (group, id, text, takes, extra = {}) => ({ id, group, text, takes, ...extra });
const C = (id, text, takes, extra) => line('callout', id, text, takes, extra);
const M = (id, text, takes, extra) => line('match', id, text, takes, extra);

// ---- shot callouts (contract section 2) --------------------------------------------------
const CALLOUT_LINES = [
  // the big ones: these lose their minds
  C('hole-in-one', 'HOLE IN ONE!!!', [
    '[screaming with joy, losing his mind] HOLE! IN! ONE!!!',
    '[screaming, ecstatic] HOOOLE IN OOOOONE!!!',
    '[screaming in disbelief] HOLE IN ONE!!! HOLE! IN! ONE!!!',
  ], { maxS: 5 }),
  C('holed-out', 'HOLED OUT!', [
    '[shouting, amazed] HOLED OUT!!!',
    '[screaming, thrilled] HOOOLED OUT!',
    '[shouting in disbelief] HOLED! OUT!',
  ]),
  C('chip-in', 'CHIP IN!', [
    '[shouting, thrilled] CHIP IN!!!',
    '[excited, shouting] CHIIIP IN!',
    '[shouting, delighted] CHIP! IN!',
  ]),
  C('drained', 'DRAINED IT!', [
    '[shouting, thrilled] DRAINED IT!!!',
    '[excited, shouting] DRAAAINED IT!',
    '[shouting, grinning] DRAINED! IT!',
  ]),
  C('in-the-hole', 'IN THE HOLE!', [
    '[shouting, thrilled] IN THE HOLE!!!',
    '[excited, shouting] IN THE HOOOLE!',
    '[shouting] IN! THE! HOLE!',
  ]),
  C('pin-seeker', 'PIN SEEKER!', [
    '[shouting, impressed] PIN SEEKER!!!',
    '[excited, shouting] PIN SEEEEKER!',
    '[shouting, awestruck] PIN! SEEKER!',
  ]),
  C('dart', 'DART!', [
    '[shouting, impressed] DART!!!',
    '[excited, shouting] DAAART!',
    '[shouting, punchy] DART!',
  ]),
  C('dance-floor', 'ON THE DANCE FLOOR!', [
    '[shouting, grinning] ON THE DANCE FLOOR!',
    '[excited, playful, shouting] ON THE DAAANCE FLOOR!',
    '[shouting, happy] ON! THE! DANCE FLOOR!',
  ]),
  C('bomb', 'ABSOLUTE BOMB!', [
    '[shouting, awestruck] ABSOLUTE BOMB!!!',
    '[screaming, amazed] ABSOLUTE BOOOMB!',
    '[shouting, slow and heavy] AB-SO-LUTE! BOMB!',
  ]),
  C('striped', 'STRIPED IT!', [
    '[shouting, impressed] STRIPED IT!!!',
    '[excited, shouting] STRIIIPED IT!',
    '[shouting, grinning] STRIPED! IT!',
  ]),
  C('perfect', 'PERFECT SHOT!', [
    '[shouting, thrilled] PERFECT SHOT!!!',
    '[excited, shouting] PERRRFECT SHOT!',
    '[shouting, awestruck] PERFECT! SHOT!',
  ]),
  C('great-shot', 'GREAT SHOT!', [
    '[shouting, happy] GREAT SHOT!!!',
    '[excited, shouting] GREEEAT SHOT!',
    '[shouting, punchy] GREAT! SHOT!',
  ]),
  C('nice-shot', 'NICE SHOT!', [
    '[shouting, happy] NICE SHOT!',
    '[excited, grinning] NIIICE SHOT!',
    '[shouting, punchy] NICE! SHOT!',
  ]),
  C('blast-off', 'BLAST OFF!', [
    '[shouting, hyped] BLAST OFF!!!',
    '[screaming, hyped] BLAAAST OFF!',
    '[shouting, booming] BLAST! OFF!',
  ]),
  // the near misses: agony
  C('robbed', 'ROBBED!', [
    '[shouting, outraged] ROBBED!!!',
    '[groaning, shouting in disbelief] ROOOBBED!',
    '[shouting, agonized] ROBBED!',
  ]),
  C('so-close', 'SO CLOSE!', [
    '[shouting, agonized] SO CLOSE!',
    '[groaning, shouting] SOOOO CLOSE!',
    '[shouting, wincing] SO! CLOSE!',
  ]),
  // the funny ones: a grin and a stretch
  C('terrible', 'TERRIBLE!', [
    '[shouting, disgusted] TERRIBLE!',
    '[laughing, mocking] TERRRIBLE!',
    '[shouting, deadpan, harsh] TERRIBLE!!!',
  ]),
  C('slice-house', 'SLICE HOUSE!', [
    '[shouting, grinning, mocking] SLIIICE HOUSE!',
    '[laughing] SLICE HOUSE!',
    '[shouting, sing-song, teasing] SLIIIIICE HOOOUSE!',
  ]),
  C('hook-city', 'HOOK CITY!', [
    '[shouting, grinning, mocking] HOOOK CITY!',
    '[laughing] HOOK CITY!',
    '[shouting, teasing] HOOK! CITY!',
  ]),
  C('shank', 'SHANK-A-POTAMUS!', [
    '[shouting, laughing] SHANK-A-POTAMUS!',
    '[grinning, mocking, shouting] SHAAANK-A-POTAMUS!',
    '[laughing, teasing] SHANK! A! POTAMUS!',
  ]),
  C('worm-burner', 'WORM BURNER!', [
    '[shouting, laughing] WORM BURNER!',
    '[grinning, mocking, shouting] WOOORM BURNER!',
    '[shouting, teasing] WORM! BURNER!',
  ]),
  C('sky-ball', 'SKY BALL!', [
    '[shouting, laughing] SKY BALL!',
    '[grinning, mocking, shouting] SKYYYY BALL!',
    '[shouting, teasing] SKY! BALL!',
  ]),
  C('chunk', 'CHUNK CITY!', [
    '[shouting, laughing] CHUNK CITY!',
    '[grinning, mocking, shouting] CHUUUNK CITY!',
    '[shouting, teasing] CHUNK! CITY!',
  ]),
  C('splash', 'IN THE DRINK!', [
    '[shouting, amused] IN THE DRINK!',
    '[laughing, shouting] IN THE DRIIINK!',
    '[shouting, mock sympathy] IN! THE! DRINK!',
  ]),
  C('lava', 'MELTED!', [
    '[shouting, grinning] MELTED!',
    '[laughing, villainous] MELLLTED!',
    '[shouting, gleeful] MELTED!!!',
  ]),
  C('ob', 'SEE YA!', [
    '[shouting, cheerful, mocking] SEE YA!',
    '[laughing] SEEEE YA!',
    '[sing-song, teasing, shouting] SEE YAAA!',
  ]),
  C('beach', 'BEACH DAY!', [
    '[shouting, cheerful, mocking] BEACH DAY!',
    '[laughing, shouting] BEEEACH DAY!',
    '[shouting, teasing] BEACH! DAY!',
  ]),
  C('timber', 'TIMBER!', [
    '[shouting like a lumberjack] TIMBERRR!',
    '[laughing, shouting] TIIIMBER!',
    '[shouting, booming] TIMBER!!!',
  ]),
  C('on-fire', "YOU'RE ON FIRE!", [
    "[shouting, hyped] YOU'RE ON FIRE!!!",
    "[screaming, hyped] YOU'RE ON FIIIRE!",
    "[shouting, awestruck] YOU'RE! ON! FIRE!",
  ]),
  C('unstoppable', 'UNSTOPPABLE!', [
    '[shouting, awestruck] UNSTOPPABLE!!!',
    '[screaming, hyped] UNSTOOOPPABLE!',
    '[shouting, slow and heavy] UN-STOP-PABLE!',
  ]),
];

// ---- match lines (contract section 3) ----------------------------------------------------
const NUMBERS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

const MATCH_LINES = [
  M('m-versus', 'VERSUS!', [
    '[shouting, booming, dramatic] VERSUS!!!',
    '[booming, dramatic] VERRRSUS!',
    '[shouting, hyped] VERSUS!',
  ]),
  M('m-player-1', 'PLAYER ONE', [
    '[shouting, announcing] PLAYER ONE!',
    '[booming, announcing] PLAYER! ONE!',
    '[shouting, hyped] PLAYER OOONE!',
  ]),
  M('m-player-2', 'PLAYER TWO', [
    '[shouting, announcing] PLAYER TWO!',
    '[booming, announcing] PLAYER! TWO!',
    '[shouting, hyped] PLAYER TWOOO!',
  ]),
  M('m-get-ready', 'GET READY!', [
    '[shouting, hyped] GET READY!!!',
    '[booming, dramatic] GET! READY!',
    '[shouting, excited] GET REEEADY!',
  ]),
  M('m-tee-off', 'TEE OFF!', [
    '[shouting, hyped] TEE OFF!!!',
    '[booming, announcing] TEE! OFF!',
    '[shouting, excited] TEEEE OFF!',
  ]),
  M('m-youre-up', "YOU'RE UP!", [
    "[shouting, hyped] YOU'RE UP!",
    "[booming, announcing] YOU'RE! UP!",
    "[shouting, excited] YOU'RE UUUP!",
  ]),
  M('m-wins-the-hole', 'WINS THE HOLE!', [
    '[shouting, announcing] WINS THE HOLE!!!',
    '[booming, announcing] WINS! THE! HOLE!',
    '[shouting, thrilled] WINS THE HOOOLE!',
  ]),
  M('m-wins-the-match', 'WINS THE MATCH!', [
    '[shouting, triumphant] WINS THE MATCH!!!',
    '[booming, triumphant] WINS! THE! MATCH!',
    '[screaming, thrilled] WINS THE MAAATCH!',
  ]),
  M('m-player-1-wins', 'PLAYER ONE WINS!', [
    '[shouting, triumphant] PLAYER ONE WINS!!!',
    '[booming, triumphant] PLAYER ONE! WINS!',
    '[screaming, thrilled] PLAYER ONE WIIINS!',
  ]),
  M('m-player-2-wins', 'PLAYER TWO WINS!', [
    '[shouting, triumphant] PLAYER TWO WINS!!!',
    '[booming, triumphant] PLAYER TWO! WINS!',
    '[screaming, thrilled] PLAYER TWO WIIINS!',
  ]),
  // the knockouts: a hammer
  M('m-knockout', 'KNOCKOUT!', [
    '[shouting, booming, brutal] KNOCKOUT!!!',
    '[booming, slow, dramatic] KNOCK! OUT!',
    '[screaming] KNOOOCKOUT!!!',
  ]),
  M('m-must-hole', 'MUST MAKE THIS!', [
    '[shouting, tense, urgent] MUST MAKE THIS!',
    '[low, intense, dramatic] MUST! MAKE! THIS!',
    '[shouting, dramatic] MUST MAKE THIIIS!',
  ]),
  M('m-sudden-death', 'SUDDEN DEATH!', [
    '[booming, ominous, dramatic] SUDDEN DEATH!!!',
    '[shouting, dramatic] SUDDEN! DEATH!',
    '[booming, slow, menacing] SUDDEN DEEEATH!',
  ]),
  M('m-closest-to-the-pin', 'CLOSEST TO THE PIN!', [
    '[shouting, announcing] CLOSEST TO THE PIN!',
    '[booming, dramatic] CLOSEST! TO THE! PIN!',
    '[shouting, hyped] CLOSEST TO THE PIIIN!',
  ]),
  M('m-all-square', 'ALL SQUARE!', [
    '[shouting, announcing] ALL SQUARE!',
    '[booming, dramatic] ALL! SQUARE!',
    '[shouting, tense] ALL SQUAAARE!',
  ]),
  M('m-match-point', 'MATCH POINT!', [
    '[shouting, tense, dramatic] MATCH POINT!!!',
    '[booming, dramatic] MATCH! POINT!',
    '[shouting, hyped] MAAATCH POINT!',
  ]),
  M('m-final-hole', 'FINAL HOLE!', [
    '[shouting, dramatic] FINAL HOLE!!!',
    '[booming, dramatic] FINAL! HOLE!',
    '[shouting, hyped] FINAL HOOOLE!',
  ]),
  M('m-flawless', 'FLAWLESS VICTORY!', [
    '[booming, dramatic, triumphant] FLAWLESS VICTORY!!!',
    '[shouting, awestruck] FLAWLESS! VICTORY!',
    '[booming, slow] FLAAAWLESS VICTORY!',
  ]),
  M('m-comeback', 'WHAT A COMEBACK!', [
    '[shouting, amazed] WHAT A COMEBACK!!!',
    '[screaming in disbelief] WHAT! A! COMEBACK!',
    '[shouting, thrilled] WHAT A COOOMEBACK!',
  ]),
  M('m-champion', 'CHAMPION!', [
    '[shouting, triumphant] CHAMPION!!!',
    '[booming, triumphant] CHAAAMPION!',
    '[screaming, thrilled] CHAMPION!',
  ]),
  M('m-quick-match', 'QUICK MATCH', [
    '[shouting, announcing, punchy] QUICK MATCH!',
    '[booming, announcing] QUICK! MATCH!',
    '[shouting, hyped] QUIIICK MATCH!',
  ]),
  M('m-best-of-3', 'BEST OF THREE', [
    '[shouting, announcing] BEST OF THREE!',
    '[booming, announcing] BEST! OF! THREE!',
    '[shouting, hyped] BEST OF THREEE!',
  ]),
  M('m-best-of-9', 'BEST OF NINE', [
    '[shouting, announcing] BEST OF NINE!',
    '[booming, announcing] BEST! OF! NINE!',
    '[shouting, hyped] BEST OF NIIINE!',
  ]),
  ...NUMBERS.map((word, i) => M(`m-hole-${i + 1}`, `HOLE ${word}`, [
    `[shouting, announcing] HOLE ${word}!`,
    `[booming, announcing] HOLE! ${word}!`,
  ])),
  M('m-takes-the-lead', 'TAKES THE LEAD!', [
    '[shouting, announcing] TAKES THE LEAD!!!',
    '[booming, dramatic] TAKES! THE! LEAD!',
    '[shouting, hyped] TAKES THE LEEEAD!',
  ]),
  M('m-sabotage', 'SABOTAGE!', [
    '[shouting, mischievous, gleeful] SABOTAGE!!!',
    '[villainous, laughing] SABOTAAAGE!',
    '[shouting, dramatic] SABOTAGE!',
  ]),
  M('m-new-record', 'NEW RECORD!', [
    '[shouting, thrilled] NEW RECORD!!!',
    '[booming, announcing] NEW! RECORD!',
    '[screaming, amazed] NEW REEECORD!',
  ]),
  // what the player who is up is playing for (added after the contract; said after their name)
  M('m-for-the-win', 'FOR THE WIN!', [
    '[booming, slow, drawn out, like a boxing ring announcer] FOOOR THE WIIIN!',
    '[shouting, tense, dramatic] FOR THE WIN!!!',
    '[booming, tense, dramatic] FOR THE WIIIIIN!',
  ], { maxS: 4 }),
  M('m-to-tie', 'TO TIE!', [
    '[shouting, urgent, tense] TO TIE!',
    '[shouting, urgent] TO TIIIE!',
  ]),
  M('m-putt-in-to-win', 'PUTT IN TO WIN!', [
    '[shouting, tense, dramatic] PUTT IN TO WIN!',
    '[booming, tense] PUTT IN TO WIIIN!',
  ]),
  M('m-chip-in-to-win', 'CHIP IN TO WIN!', [
    '[shouting, tense, dramatic] CHIP IN TO WIN!',
    '[booming, tense] CHIP IN TO WIIIN!',
  ]),
  M('m-putt-in-to-tie', 'PUTT IN TO TIE!', [
    '[shouting, urgent, tense] PUTT IN TO TIE!',
    '[shouting, urgent] PUTT IN TO TIIIE!',
  ]),
  M('m-chip-in-to-tie', 'CHIP IN TO TIE!', [
    '[shouting, urgent, tense] CHIP IN TO TIE!',
    '[shouting, urgent] CHIP IN TO TIIIE!',
  ]),
];

// ---- stages (contract section 1): `stage-<id>`, the stage name -----------------------------
export const STAGES = [
  ['lagoon-island', 'LAGOON ISLAND'],
  ['canyon-run', 'CANYON RUN'],
  ['lighthouse-point', 'LIGHTHOUSE POINT'],
  ['volcano-drop', 'VOLCANO DROP'],
  ['frostbite-ridge', 'FROSTBITE RIDGE'],
  ['sakura-garden', 'SAKURA GARDEN'],
  ['temple-run', 'TEMPLE RUN'],
  ['pharaohs-gate', "PHARAOH'S GATE"],
  ['midnight-mile', 'MIDNIGHT MILE'],
  ['bullseye-bay', 'BULLSEYE BAY'],
  ['thunder-dome', 'THUNDER DOME'],
  ['ice-pick', 'ICE PICK'],
  // added by the hole streams after the contract's twelve
  ['dragons-spine', "DRAGON'S SPINE"],
  ['sky-fortress', 'SKY FORTRESS'],
  ['summit-express', 'SUMMIT EXPRESS'],
];

const STAGE_LINES = STAGES.map(([id, name]) => line('stage', `stage-${id}`, name, [
  `[booming, announcing, dramatic] ${name}!`,
  `[shouting, hyped, announcing] ${name}!!!`,
]));

// ---- power-ups (contract section 5): `pu-<id>`, the ball's name shouted ---------------------
export const POWERUPS = [
  ['rocket', 'ROCKET BALL!'],
  ['sticky', 'STICKY BALL!'],
  ['magnet', 'MAGNET BALL!'],
  ['windcutter', 'WIND CUTTER!'],
  ['laser', 'LASER BALL!'],
  ['moonball', 'MOON BALL!'],
  ['bouncy', 'BOUNCY BALL!'],
  ['fireball', 'FIREBALL!'],
  ['ghost', 'GHOST BALL!'],
  ['skipper', 'SKIPPER!'],
  ['yoyo', 'YO-YO BALL!'],
  ['homing', 'HOMING BALL!'],
  ['titan', 'TITAN BALL!'],
  ['feather', 'FEATHER BALL!'],
  ['gold', 'GOLDEN BALL!'],
  // tricks (sabotage on the opponent)
  ['gust', 'GUST!'],
  ['tiny-cup', 'TINY CUP!'],
  ['fog', 'FOG!'],
];

const TRICKS = new Set(['gust', 'tiny-cup', 'fog']);
const POWERUP_LINES = POWERUPS.map(([id, text]) => {
  const bare = text.replace(/!+$/, '');
  return line('powerup', `pu-${id}`, text, TRICKS.has(id)
    ? [`[shouting, mischievous, gleeful] ${bare}!!!`, `[villainous, shouting] ${bare}!`]
    : [`[shouting, hyped] ${bare}!!!`, `[booming, excited, announcing] ${bare}!`]);
});

// ---- added after the contract by the feature streams ---------------------------------------
// Each id below is one the game asks for by name; the text is the banner's own words where
// there is a banner. Delivery notes are per take, as everywhere above: the first take is the
// plain shout, the second the stretched one, the third (where there is one) staccato or a
// laugh. Lines heard many times a round have three takes.
const G = (id, text, takes, extra) => line('gadget', id, text, takes, extra);
const P = (id, text, takes, extra) => line('party', id, text, takes, extra);
const B = (id, text, takes, extra) => line('bullseye', id, text, takes, extra);
const D = (id, text, takes, extra) => line('duel', id, text, takes, extra);
const R = (id, text, takes, extra) => line('replay', id, text, takes, extra);

// Course gadgets (lib/gadgets.js GADGET_CALLOUTS: id, banner text, tone). Said by the HUD as
// the shot's callout, so the tone sets the delivery: epic loses its mind, good is a happy
// shout, funny grins.
const GADGET_LINES = [
  G('full-trail', 'FULL TRAIL!', [
    '[shouting, thrilled] FULL TRAIL!!!',
    '[screaming, hyped] FULL TRAAAIL!',
    '[shouting, awestruck] FULL! TRAIL!',
  ]),
  G('smashed-it', 'SMASHED IT!', [
    '[shouting, booming, gleeful] SMASHED IT!!!',
    '[screaming, thrilled] SMAAASHED IT!',
    '[shouting, punchy] SMASHED! IT!',
  ]),
  G('triple-up', 'TRIPLE UP!', [
    '[shouting, thrilled] TRIPLE UP!!!',
    '[screaming, hyped] TRIIIPLE UP!',
    '[shouting, awestruck] TRIPLE! UP!',
  ]),
  G('warp-speed', 'WARP SPEED!', [
    '[shouting, hyped] WARP SPEED!!!',
    '[excited, shouting] WAAARP SPEED!',
    '[booming, announcing] WARP! SPEED!',
  ]),
  G('ring-it', 'RING IT!', [
    '[shouting, happy] RING IT!',
    '[excited, shouting] RIIING IT!',
    '[shouting, punchy] RING! IT!',
  ]),
  G('double-up', 'DOUBLE UP!', [
    '[shouting, happy] DOUBLE UP!!!',
    '[excited, shouting] DOUBLE UUUP!',
    '[shouting, punchy] DOUBLE! UP!',
  ]),
  G('thar-she-blows', 'THAR SHE BLOWS!', [
    '[shouting like an old sea captain] THAR SHE BLOWS!',
    '[shouting, gleeful, booming] THAR SHE BLOOOWS!',
    '[laughing, shouting] THAR SHE BLOWS!!!',
  ]),
  G('boing', 'BOING!', [
    '[shouting, playful, grinning] BOING!',
    '[sing-song, teasing, shouting] BOOOIIING!',
    '[shouting, cheerful, mocking] BOING!!!',
  ]),
  G('pinball', 'PINBALL WIZARD!', [
    '[shouting, grinning, amused] PINBALL WIZARD!',
    '[shouting, teasing, sing-song] PIIINBALL WIZARD!',
    '[laughing, shouting] PINBALL WIZARD!!!',
  ]),
  G('turbo', 'TURBO!', [
    '[shouting, hyped] TURBO!!!',
    '[screaming, hyped] TURRRBO!',
    '[booming, punchy] TURBO!',
  ]),
  G('denied', 'DENIED!', [
    '[shouting, booming, gleeful] DENIED!!!',
    '[shouting, mocking, grinning] DENIIIED!',
    '[shouting, deadpan, harsh] DENIED!',
  ]),
  G('stuck', 'STUCK IN THE MUD!', [
    '[shouting, amused] STUCK IN THE MUD!',
    '[shouting, mock sympathy] STUCK IN THE MUUUD!',
    '[laughing, shouting] STUCK IN THE MUD!!!',
  ]),
];

// Party games for three and four (public/arcade/party.js). The three format names are read
// like QUICK MATCH; "TO STAY ALIVE", "FOR THE SKINS", "TAKES THE SKIN", "IS OUT" and "WINS THE
// GAME" follow a player's name, so they start on the verb; slots 3 and 4 match PLAYER ONE.
const PARTY_LINES = [
  P('p-skins', 'SKINS', [
    '[shouting, announcing, punchy] SKINS!',
    '[booming, announcing] SKIIINS!',
    '[shouting, hyped] SKINS!!!',
  ]),
  P('p-stroke-race', 'STROKE RACE', [
    '[shouting, announcing, punchy] STROKE RACE!',
    '[shouting, hyped] STROKE RAAACE!',
    '[booming, announcing] STROKE! RACE!',
  ]),
  P('p-elimination', 'ELIMINATION', [
    '[booming, ominous, dramatic] ELIMINATION!',
    '[shouting, announcing] ELIMINATION!!!',
    '[booming, slow, menacing] ELIMINAAATION!',
  ]),
  P('p-to-stay-alive', 'TO STAY ALIVE!', [
    '[shouting, urgent, tense] TO STAY ALIVE!',
    '[booming, tense, dramatic] TO STAY ALIIIVE!',
  ]),
  P('p-for-the-skins', 'FOR THE SKINS!', [
    '[shouting, tense, dramatic] FOR THE SKINS!!!',
    '[booming, tense, dramatic] FOR THE SKIIINS!',
  ]),
  P('p-takes-the-skin', 'TAKES THE SKIN!', [
    '[shouting, announcing] TAKES THE SKIN!!!',
    '[shouting, thrilled] TAKES THE SKIIIN!',
    '[booming, announcing] TAKES! THE! SKIN!',
  ]),
  P('p-skin-carries', 'THE SKIN CARRIES!', [
    '[shouting, tense, dramatic] THE SKIN CARRIES!',
    '[booming, dramatic] THE SKIN CAAARRIES!',
  ]),
  P('p-is-out', 'IS OUT!', [
    '[shouting, booming, brutal] IS OUT!!!',
    '[booming, slow, dramatic] IS OUUUT!',
    '[shouting, harsh, punchy] IS! OUT!',
  ]),
  P('p-the-final', 'THE FINAL!', [
    '[booming, dramatic, announcing] THE FINAL!!!',
    '[shouting, hyped] THE FIIINAL!',
  ]),
  P('p-farthest-is-out', 'FARTHEST IS OUT!', [
    '[shouting, tense, dramatic] FARTHEST IS OUT!',
    '[booming, ominous, dramatic] FARTHEST IS OUUUT!',
  ]),
  P('p-wins-the-game', 'WINS THE GAME!', [
    '[shouting, triumphant] WINS THE GAME!!!',
    '[screaming, thrilled] WINS THE GAAAME!',
    '[booming, triumphant] WINS! THE! GAME!',
  ]),
  P('m-player-3', 'PLAYER THREE', [
    '[shouting, announcing] PLAYER THREE!',
    '[shouting, hyped] PLAYER THREEE!',
    '[booming, announcing] PLAYER! THREE!',
  ]),
  P('m-player-4', 'PLAYER FOUR', [
    '[shouting, announcing] PLAYER FOUR!',
    '[shouting, hyped] PLAYER FOOOUR!',
    '[booming, announcing] PLAYER! FOUR!',
  ]),
  P('m-player-3-wins', 'PLAYER THREE WINS!', [
    '[shouting, triumphant] PLAYER THREE WINS!!!',
    '[screaming, thrilled] PLAYER THREE WIIINS!',
    '[booming, triumphant] PLAYER THREE! WINS!',
  ]),
  P('m-player-4-wins', 'PLAYER FOUR WINS!', [
    '[shouting, triumphant] PLAYER FOUR WINS!!!',
    '[screaming, thrilled] PLAYER FOUR WIIINS!',
    '[booming, triumphant] PLAYER FOUR! WINS!',
  ]),
];

// Bullseye, the duel and the replays (docs/modes.md lists these as the ids each mode wants;
// the screens play existing lines until their callers switch to these).
const ROUNDS = ['TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
const BULLSEYE_LINES = [
  B('be-bullseye', 'BULLSEYE!', [
    '[shouting, thrilled] BULLSEYE!!!',
    '[screaming, hyped] BULLSEYYYE!',
    '[shouting, awestruck] BULLS! EYE!',
  ]),
  B('be-double', 'DOUBLE!', [
    '[shouting, happy] DOUBLE!',
    '[excited, shouting] DOUUUBLE!',
  ]),
  B('be-treble', 'TREBLE!', [
    '[shouting, thrilled] TREBLE!!!',
    '[excited, shouting] TREEEBLE!',
  ]),
  B('be-perfect-turn', 'PERFECT TURN!', [
    '[screaming with joy, losing his mind] PERFECT TURN!!!',
    '[shouting, awestruck] PERRRFECT TURN!',
  ]),
  B('be-bust', 'BUST!', [
    '[shouting, deadpan, harsh] BUST!',
    '[shouting, grinning, mocking] BUUUST!',
    '[shouting, booming, gleeful] BUST!!!',
  ]),
  B('be-check-out', 'CHECK OUT!', [
    '[shouting, triumphant] CHECK OUT!!!',
    '[screaming, thrilled] CHECK OUUUT!',
  ]),
  B('be-can-anyone-answer', 'CAN ANYONE ANSWER?', [
    '[booming, tense, dramatic] CAN ANYONE ANSWER?',
    '[shouting, tense, urgent] CAN ANYONE AAANSWER?',
  ]),
  B('be-nearest-the-pin', 'NEAREST THE PIN TONIGHT!', [
    '[shouting, impressed] NEAREST THE PIN TONIGHT!',
    '[shouting, thrilled] NEAREST THE PIIIN TONIGHT!',
  ]),
  ...ROUNDS.map((word, i) => B(`be-round-${i + 2}`, `ROUND ${word}`, [
    `[shouting, announcing] ROUND ${word}!`,
    `[booming, announcing] ROUND! ${word}!`,
  ])),
  B('be-final-round', 'FINAL ROUND!', [
    '[shouting, dramatic] FINAL ROUND!!!',
    '[booming, dramatic] FINAL ROUUUND!',
  ]),
];

const DUEL_LINES = [
  D('dl-call-your-shot', 'CALL YOUR SHOT!', [
    '[shouting, hyped, announcing] CALL YOUR SHOT!',
    '[booming, dramatic] CALL YOUR SHOOOT!',
  ]),
  D('dl-match-it', 'MATCH IT!', [
    '[shouting, tense, urgent] MATCH IT!',
    '[booming, dramatic] MAAATCH IT!',
    '[shouting, hyped] MATCH IT!!!',
  ]),
  D('dl-matched', 'MATCHED!', [
    '[shouting, thrilled] MATCHED!!!',
    '[excited, shouting] MAAATCHED!',
    '[shouting, impressed] MATCHED!',
  ]),
  D('dl-letter', "THAT'S A LETTER!", [
    "[shouting, grinning, mocking] THAT'S A LETTER!",
    "[shouting, cheerful, mocking] THAT'S A LEEETTER!",
    "[shouting, deadpan, harsh] THAT'S A LETTER!!!",
  ]),
  D('dl-no-call', 'NO CALL!', [
    '[shouting, deadpan, harsh] NO CALL!',
    '[shouting, amused] NO CAAALL!',
  ]),
  D('dl-one-letter-left', 'ONE LETTER LEFT!', [
    '[shouting, tense, dramatic] ONE LETTER LEFT!',
    '[booming, ominous, dramatic] ONE LETTER LEEEFT!',
  ]),
  D('dl-spelled-it', 'SPELLED IT!', [
    '[shouting, booming, brutal] SPELLED IT!!!',
    '[shouting, grinning, mocking] SPEEELLED IT!',
  ]),
];

const REPLAY_LINES = [
  R('m-replay', "LET'S SEE THAT AGAIN!", [
    "[shouting, excited, announcing] LET'S SEE THAT AGAIN!",
    "[shouting, impressed, grinning] LET'S SEE THAT AGAAAIN!",
  ]),
  R('m-shot-of-the-match', 'THE SHOT OF THE MATCH!', [
    '[booming, dramatic, announcing] THE SHOT OF THE MATCH!',
    '[shouting, awestruck] THE SHOT OF THE MAAATCH!',
  ]),
  R('m-highlights', "TONIGHT'S BEST!", [
    "[shouting, hyped, announcing] TONIGHT'S BEST!",
    "[booming, announcing] TONIGHT'S BEEEST!",
  ]),
];

export const LINES = [...CALLOUT_LINES, ...MATCH_LINES, ...STAGE_LINES, ...POWERUP_LINES,
  ...GADGET_LINES, ...PARTY_LINES, ...BULLSEYE_LINES, ...DUEL_LINES, ...REPLAY_LINES];
// How many takes of a line are rendered: all of them for these (heard many times a game),
// the first two for the rest.
export const THREE_TAKES = new Set(['nice-shot', 'great-shot', 'perfect', 'terrible', 'm-youre-up', 'm-for-the-win',
  'ring-it', 'boing', 'double-up', 'turbo', 'denied', 'p-is-out', 'p-takes-the-skin', 'm-player-3', 'm-player-4',
  'be-bullseye', 'be-bust', 'dl-matched', 'dl-letter', 'dl-match-it']);
export const LINE_IDS = LINES.map((l) => l.id);

/** The plain words of a line: 'SHANK-A-POTAMUS!' -> ['shank', 'a', 'potamus']. */
export function words(text) {
  return String(text).toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Do these words say this line? Word-level, forgiving of a stretched shout ("SLIIICE"), a
 * near miss by the transcriber, and words split or joined ("knock out"). Returns
 * { ok, extra, missing }. Used on a take's own text (the test) and on what a
 * speech-to-text pass heard in the rendered clip (check.mjs --transcribe).
 */
export function compareWords(transcript, text) {
  const want = words(text);
  const got = words(transcript);
  const near = (a, b) => {
    if (a === b) return true;
    // a stretched or misheard shout: same first letter and most letters in common
    const squash = (s) => s.replace(/(.)\1+/g, '$1');
    const x = squash(a);
    const y = squash(b);
    if (x === y) return true;
    if (x[0] !== y[0]) return false;
    const n = Math.max(x.length, y.length);
    let d = 0;
    // cheap edit distance
    const row = Array.from({ length: y.length + 1 }, (_, i) => i);
    for (let i = 1; i <= x.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= y.length; j++) {
        const cur = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
        prev = cur;
      }
    }
    d = row[y.length];
    return d <= Math.max(1, Math.floor(n / 3));
  };
  // the transcriber may split or join words ("knock out", "fire ball"): compare joined too
  if (near(got.join(''), want.join(''))) return { ok: true, extra: [], missing: [] };
  const extra = got.filter((g) => !want.some((w) => near(g, w)));
  const missing = want.filter((w) => !got.some((g) => near(g, w)));
  return { ok: extra.length === 0 && missing.length === 0, extra, missing };
}

/** A rough syllable count of a line's text (for the duration sanity bounds). */
export function syllables(text) {
  let n = 0;
  for (const w of words(text)) {
    const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
    n += Math.max(1, groups ? groups.length : 1);
  }
  return Math.max(1, n);
}

/**
 * How long the spoken part of a line may sanely be, in seconds. A two-word shout lands
 * between roughly 0.4 and 2.2 s; eleven_v3 sometimes rambles or adds stray speech, which
 * shows up as a clip far outside this.
 */
export function durationBounds(l) {
  const s = syllables(l.text);
  return { minS: 0.25 + 0.08 * s, maxS: l.maxS || 1.6 + 0.3 * s };
}

/** What a take costs in characters (the tags are billed too). */
export function catalogueCharacters() {
  return LINES.reduce((sum, l) => sum + l.takes.reduce((s, t) => s + t.length, 0), 0);
}

// ---- sound effects (contract section 3): one-shots, never loops ---------------------------
// seconds: what the generator is asked for. keepS: the longest the trimmed clip may be
// (the contract's limits: drumroll under 3 s, fanfare-win under 6 s, fanfare-hole under 3 s).
// fadeMs: the tail fade. takes: crowd reactions get two for variety (crowd-roar.mp3,
// crowd-roar-2.mp3; one is picked at random). Every prompt asks for a single event with a
// clean ending; nothing here is a bed.
const sfx = (cue, seconds, keepS, fadeMs, takes, prompt, extra = {}) => ({ cue, seconds, keepS, fadeMs, takes, prompt, ...extra });

export const SFX = [
  sfx('crowd-roar', 4, 3.6, 900, 2,
    'A huge stadium crowd at a golf tournament erupts into a massive roar the instant the ball drops in the hole: explosive cheering, screaming and whistles, then dying down. One single eruption, no music, no commentary.'),
  sfx('crowd-cheer', 3, 2.6, 700, 2,
    'A big golf gallery crowd bursts into a short happy cheer with clapping and a few whoops after a great shot, then fades. One short burst, no music, no speech.'),
  sfx('crowd-ohh', 2.5, 2.2, 500, 2,
    'A large stadium crowd groans one long loud "OHHHHH!" in unison as a golf putt just misses the hole, agonised near miss, voices falling in pitch at the end. One reaction, no music, no speech.'),
  sfx('crowd-aww', 2.5, 2.0, 500, 2,
    'A large crowd lets out one disappointed "awwww" together after a bad golf shot, sympathetic and deflated, falling in pitch. One short reaction, no music, no speech.'),
  sfx('crowd-gasp', 1.5, 1.2, 300, 2,
    'A large crowd gasps sharply all at once in shock, a single sudden collective intake of breath. Very short, no music, no speech.'),
  sfx('crowd-laugh', 2.5, 2.2, 500, 2,
    'A big stadium crowd bursts out laughing together at a comically bad golf shot, one hearty burst of laughter that quickly dies away. No music, no speech.'),
  sfx('applause', 3.5, 3.0, 800, 2,
    'A golf tournament gallery gives a warm round of applause, enthusiastic clapping that swells quickly and then tapers off. One round of applause, no music, no speech.'),
  sfx('whoosh', 0.8, 0.7, 120, 1,
    'A fast clean whoosh swipe for a video game screen transition, airy and punchy, single swish.', { influence: 0.6 }),
  sfx('vs-slam', 1.5, 1.4, 300, 1,
    'A massive cinematic impact slam for a fighting game VERSUS screen: heavy metallic boom with a deep sub hit and a short reverb tail. Single hit.', { influence: 0.6 }),
  sfx('drumroll', 3, 2.8, 150, 1,
    'A tense snare drum roll that builds in intensity and ends with a single cymbal crash. Game show suspense, short.', { influence: 0.6 }),
  sfx('fanfare-win', 5.5, 5.4, 600, 1,
    'A triumphant brass and orchestra victory fanfare for winning an arcade sports video game match: bold, heroic, celebratory, with a big final chord and cymbal. Complete short jingle with a clear ending.', { influence: 0.6 }),
  sfx('fanfare-hole', 2.8, 2.7, 400, 1,
    'A short bright brass victory sting for winning a round in an arcade sports video game: three quick rising notes and a final chord. Complete jingle with a clear ending.', { influence: 0.6 }),
  sfx('sting-fail', 1.8, 1.7, 300, 1,
    'A short comedic fail sting for an arcade video game: descending "wah wah" brass with a low thud at the end. Single sting.', { influence: 0.6 }),
  sfx('sting-knockout', 2, 1.9, 400, 1,
    'A brutal knockout sting for a fighting video game: a huge punch impact, a boxing ring bell struck once, and a deep boom. Single dramatic hit.', { influence: 0.6 }),
  sfx('countdown-beep', 0.5, 0.35, 60, 1,
    'A single short clean electronic countdown beep for a video game race start, one tone.', { influence: 0.7 }),
  sfx('chest-open', 2, 1.8, 350, 1,
    'A treasure chest opens in a video game: a wooden creak and latch click, then a magical shimmering sparkle reveal. Single short effect.', { influence: 0.6 }),
  sfx('coin-burst', 1.5, 1.3, 250, 1,
    'A burst of many gold coins spraying out and jingling in an arcade video game reward, bright and sparkling. Single short burst.', { influence: 0.6 }),
  sfx('trick-cast', 1.5, 1.3, 250, 1,
    'A mischievous dark magic spell being cast in a cartoon video game: a quick rising zap with a wicked shimmer and a soft poof. Single short effect.', { influence: 0.6 }),
  // One existing crowd cue gets its own sample: the rising "ooooh" as a ball closes on the cup.
  sfx('oooh', 2.2, 1.9, 450, 2,
    'A large golf crowd makes one rising, excited, anticipating "oooooOOOH" together as a ball rolls toward the hole, building in pitch and volume. One reaction, no music, no speech.'),

  // ---- the physical game: what a real swing's ball does. Close, dry, no crowd, no music.
  // Two takes where the same sound comes round often enough to be noticed.
  sfx('cup-drop', 1.2, 1.0, 150, 2,
    'A golf ball drops into the hole and rattles around the bottom of the plastic cup: a hollow clatter of three or four quick knocks that settle. Close-up, dry, very satisfying. No crowd, no music.', { influence: 0.6 }),
  sfx('flag-clank', 1.0, 0.9, 200, 2,
    'A golf ball strikes a metal flagstick: one sharp bright clank with a short metallic ring. Close-up, dry. No crowd, no music.', { influence: 0.6 }),
  sfx('green-thump', 0.7, 0.5, 100, 2,
    'A golf ball lands on a firm putting green: one soft low thud. Close-up, dry, single impact. No crowd, no music.', { influence: 0.6 }),
  sfx('fairway-bounce', 0.7, 0.5, 100, 2,
    'A golf ball bounces once on short mown fairway grass: one firm muted thump. Close-up, dry, single impact. No crowd, no music.', { influence: 0.6 }),
  sfx('sand-thud', 0.9, 0.7, 150, 2,
    'A golf ball plugs into bunker sand: one soft dull thud with a small spray of sand grains. Close-up, dry. No crowd, no music.', { influence: 0.6 }),
  sfx('tree-knock', 1.0, 0.8, 180, 2,
    'A golf ball hits a tree trunk: one loud hollow woody knock followed by a short rustle of leaves. Close-up, dry. No crowd, no music.', { influence: 0.6 }),
  sfx('water-plunk', 1.4, 1.2, 250, 2,
    'A golf ball drops into a pond: one deep plunk and a small splash with a few droplets after. Close-up. No crowd, no music.', { influence: 0.6 }),
  sfx('lava-sizzle', 2, 1.7, 400, 1,
    'A golf ball drops into molten lava: a heavy gloopy plop, then a fierce sizzling hiss of steam that dies away quickly. Single event. No music.', { influence: 0.6 }),
  sfx('ice-skid', 1.2, 1.0, 200, 1,
    'A golf ball lands on a frozen lake: one hard glassy tick, then a short icy scraping slide. Close-up, dry. No music.', { influence: 0.6 }),
  sfx('rough-rustle', 0.8, 0.6, 120, 2,
    'A golf ball drops into long thick grass: one soft muffled swish and rustle. Close-up, dry, single impact. No crowd, no music.', { influence: 0.6 }),

  // ---- game feel: small, clean, musical. The interface ticks are levelled lower still.
  sfx('ui-tick', 0.5, 0.12, 40, 1,
    'A tiny soft click tick for a video game menu hover, very short, clean and unobtrusive. Single tick.', { influence: 0.7, lufs: -26 }),
  sfx('ui-confirm', 0.6, 0.45, 80, 1,
    'A bright positive confirm chime for an arcade video game menu selection: two quick rising notes, clean and short.', { influence: 0.7, lufs: -25 }),
  sfx('ui-back', 0.6, 0.4, 80, 1,
    'A soft low cancel blip for a video game menu going back: one short descending note, clean.', { influence: 0.7, lufs: -26 }),
  sfx('turn-chime', 1.0, 0.9, 200, 1,
    'A clear bright two-note bell chime announcing the next turn in an arcade sports video game. Short, clean, friendly.', { influence: 0.7, lufs: -23 }),
  sfx('arm-common', 0.8, 0.6, 120, 1,
    'A quick power-up equip sound in an arcade video game: a short electronic click and rising blip. Small.', { influence: 0.7 }),
  sfx('arm-rare', 1.0, 0.9, 180, 1,
    'A satisfying power-up equip sound in an arcade video game: an energy charge-up with a bright shimmer. Medium.', { influence: 0.7 }),
  sfx('arm-epic', 1.5, 1.4, 250, 1,
    'An epic power-up activation in an arcade video game: a big energy surge with a deep rising boom, an electric crackle and a bright sparkle on top. Powerful, short.', { influence: 0.7 }),
  sfx('trophy-tick', 0.5, 0.1, 30, 1,
    'A single tiny bright metallic tick for a score counter counting up in a video game. One tick, very short.', { influence: 0.7, lufs: -26 }),
  sfx('confetti-pop', 1.0, 0.9, 200, 1,
    'A party popper confetti cannon: one pop and a quick flutter of paper. Single, short.', { influence: 0.6 }),
  // a single rise, under 2.5 s, that stops at its peak. Not a loop.
  sfx('riser', 2.4, 2.3, 60, 1,
    'A single tense cinematic riser: an airy whoosh and tone that climbs steadily in pitch and intensity for two seconds and stops dead at its peak. One rise, no impact at the end, not repeating.', { influence: 0.7 }),
  sfx('heartbeat-hit', 0.6, 0.55, 100, 1,
    'A single deep heavy heartbeat, one "lub-dub", cinematic tension, low and dry. One beat only.', { influence: 0.7 }),
  sfx('streak-up', 0.8, 0.7, 120, 1,
    'A quick bright ascending arpeggio for a combo streak going up in an arcade video game. Short and sparkling.', { influence: 0.7 }),
  sfx('streak-break', 1.0, 0.9, 180, 1,
    'A combo streak breaking in an arcade video game: a short descending tone and a small glassy fizzle. A little disappointing, short.', { influence: 0.7 }),
];

// Existing crowd cue names that reuse the generated crowd one-shots (kept short): the
// synthesized versions are filtered noise. cue -> the sample cue whose files it plays.
export const SFX_ALIASES = { roar: 'crowd-roar', gasp: 'crowd-gasp', splash: 'water-plunk' };

export const SFX_CUES = SFX.map((s) => s.cue);
// the physical and game-feel one-shots added to the contract's list (docs/arcade-voice.md has the sound map)
export const PHYSICAL_SFX_CUES = ['cup-drop', 'flag-clank', 'green-thump', 'fairway-bounce', 'sand-thud', 'tree-knock',
  'water-plunk', 'lava-sizzle', 'ice-skid', 'rough-rustle'];
export const FEEL_SFX_CUES = ['ui-tick', 'ui-confirm', 'ui-back', 'turn-chime', 'arm-common', 'arm-rare', 'arm-epic',
  'trophy-tick', 'confetti-pop', 'riser', 'heartbeat-hit', 'streak-up', 'streak-break'];
export const NEW_SFX_CUES = [
  'crowd-roar', 'crowd-cheer', 'crowd-ohh', 'crowd-aww', 'crowd-gasp', 'crowd-laugh', 'applause', 'whoosh', 'vs-slam',
  'drumroll', 'fanfare-win', 'fanfare-hole', 'sting-fail', 'sting-knockout', 'countdown-beep', 'chest-open', 'coin-burst',
  'trick-cast',
];

/** The file names of a cue's takes: crowd-roar.mp3, crowd-roar-2.mp3. */
export function sfxFiles(s) {
  return Array.from({ length: s.takes }, (_, i) => (i === 0 ? `${s.cue}.mp3` : `${s.cue}-${i + 1}.mp3`));
}
