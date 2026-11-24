# Arcade v2 contract (the interfaces between the parts of the game)

**Historical, and still the best map of who calls what.** The arcade game was built by
several work streams at once (hole design, the look, the match engine, the match screens,
the arcade core, the HUD, voice and sound). This file fixed the interfaces between them
before anybody wrote code: the stage format, the shot callouts and balls, the sound and
voice API, the match state and its events. The game has moved on in places (twelve match
stages now, not nine; the game shell; the Foresight bridge); where this file and the code
disagree, the code and the current docs (`docs/match.md`, `docs/arcade.md`,
`docs/arcade-holes.md`, `docs/arcade-look.md`, `docs/arcade-voice.md`) are right.

The goal it was written to: the best video-game golf ever built for a real launch monitor.
Two people in one bay, hitting real balls, playing a loud, fast, over-the-top 1v1 game.

## Ground rules the streams worked to

These are still how to work on the game with several people (or agents) at once.

- **File ownership** is listed per stream below. `public/app.js`, `public/index.html` and
  `server.js` are shared with the engine underneath: edits there are MINIMAL and additive,
  each marked with a comment `// v2:<stream>` (or `<!-- v2:<stream> -->`), and never
  reformat. The checkout may be CRLF on Windows: `tools/arcade-dev/patch.cjs` is a
  CRLF-safe anchor patcher.
- **A private test instance** per person, so nobody takes anybody else's ports or data:
  `BIRDIE_PORT=<http> BIRDIE_OC_PORT=<oc> BIRDIE_DATA_DIR=<repo>/.scratch/<stream>/data BIRDIE_ENRICH=0 BIRDIE_SKY_PREFETCH=0 node server.js`
  (build the stages into that data dir first with `node tools/arcade-holes/build.mjs --out <dir>`).
  Simulated swings: `POST /api/test-shot {speed, vla, hla, spin, spinAxis}`. Open pages with
  `?sound=0` on a machine somebody else is using, and never on the default ports
  (921 / 8222) while a real game may be running there.
- **Tests**: `node --test "test/*.test.js" "test/*.test.mjs"` stays green. Add tests for
  what you build.
- **The feel rules (from play-testing, not negotiable)**: no looping or continuous audio,
  ever; slow motion only when the ball comes by the pin; the camera follows the ball and
  never flips; good shots look like rockets; everything is over the top (banners, crowd,
  overpowered balls).
- **Reports**: what was built, files touched, shared-file edits, how it was verified, what
  is NOT done or not verified. A wrong "verified" costs more than a gap.

## Streams, owners, ports

| Stream | Owns | Ports (http / oc) |
| --- | --- | --- |
| holes-a | `tools/arcade-holes/holes/{volcano-drop,frostbite-ridge,ice-pick}.js`, `test/arcade-holes-a.test.js` | 8311 / 9941 |
| holes-b | `tools/arcade-holes/holes/{sakura-garden,temple-run,bullseye-bay}.js`, `test/arcade-holes-b.test.js` | 8312 / 9942 |
| holes-c (catalogue lead) | `tools/arcade-holes/{lib.js,courses.js,build.mjs,preview.mjs}`, `holes/{pharaohs-gate,midnight-mile,thunder-dome}.js`, the three existing holes, `test/arcade-holes.test.js`, `docs/arcade-holes.md` | 8313 / 9943 |
| look | `public/render/{arcade-look.js,props.js}` + the look hooks in other `public/render/*` files, `public/arcade/props/*`, `test/arcade-look.test.mjs`, `docs/arcade-look.md` | 8314 / 9944 |
| match-engine | `lib/match.js`, match parts of `server.js` (primary owner of `server.js`), `test/match.test.js`, `docs/match.md` | 8315 / 9945 |
| match-ui | `public/arcade/match.js`, `public/arcade/match.css`, `public/arcade/match-demo.html` | 8316 / 9946 |
| arcade-core | `lib/arcade.js`, `lib/physics.js`, arcade hooks in `lib/game.js`, `test/arcade.test.js`, `docs/arcade.md` | 8317 / 9947 |
| arcade-hud | `public/arcade/arcade.js`, `public/arcade/arcade.css`, `public/arcade/demo.html` | 8318 / 9948 |
| voice | `public/arcade/audio.js`, `public/arcade/voice/**`, `public/arcade/sfx/**`, `tools/arcade-voice/**`, `lib/voice.js`, `test/arcade-voice.test.js`, `docs/arcade-voice.md` | 8319 / 9949 |

## 1. Stages: one hole = one world

Every match hole is its own single-hole course file with its own theme, sky and wind (the
match engine switches course between holes behind a transition screen). Nine match stages
("the Clash Tour") and three tiebreak arenas (reachable par 3s for closest-to-the-pin).

| # | id | Role | Par | Target length | Theme | Idea | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `lagoon-island` | match 1 | 3 | 150 yd | `tropical` | exists: island green | holes-c |
| 2 | `canyon-run` | match 2 | 4 | 346 yd | `canyon` | exists: gorge carry to a mesa green | holes-c |
| 3 | `lighthouse-point` | match 3 | 4 | 310 yd | `links` | exists: clifftop dogleg | holes-c |
| 4 | `volcano-drop` | match 4 | 3 | 185-200 yd, big drop | `volcano` | tee on the crater rim, green on a rock island in a lava lake (lava = `water` surface) | holes-a |
| 5 | `frostbite-ridge` | match 5 | 4 | 360-390 yd | `alpine` | snow ridge fairway, frozen lake to carry or lay up beside, pines | holes-a |
| 6 | `sakura-garden` | match 6 | 3 | 125-140 yd | `sakura` | tiny green wrapped by koi ponds, bridges, cherry trees: a precision wedge | holes-b |
| 7 | `temple-run` | match 7 | 5 | 490-530 yd | `jungle` | river crosses twice; a Rocket ball can reach in one; temple behind the green | holes-b |
| 8 | `pharaohs-gate` | match 8 | 4 | 285-305 yd, drivable | `desert` | split fairway round a giant bunker, green between two pyramids | holes-c |
| 9 | `midnight-mile` | match 9 (finale) | 5 | 530-560 yd | `neon` | night city: wide neon-lit fairway, canal down the left, stadium finish | holes-c |
| 21 | `bullseye-bay` | tiebreak | 3 | 110-120 yd | `tropical` | huge round target green in a calm bay, concentric scoring rings (props) | holes-b |
| 22 | `thunder-dome` | tiebreak | 3 | 135-145 yd | `stadium` | a bowl: grandstands all round, floodlights, level green | holes-c |
| 23 | `ice-pick` | tiebreak | 3 | 95-105 yd, downhill | `alpine` | short drop shot to a green on a frozen tarn | holes-a |

`#` is the course `number` (synthetic id `osm:node:9900000000000+#`, file
`osm-node-99000000000NN.json`). Design for REAL swings by average golfers: generous fairways,
big greens (at least 28 x 24 m, tiebreak greens 34 m+ across), slopes under 3 % on greens,
hazards that are visible and dramatic rather than hidden. Every hole needs a safe way to play
it and a hero way.

### Hole file shape (`tools/arcade-holes/holes/<id>.js`)

The piece object as today (see `holes/lagoon-island.js` and `docs/arcade-holes.md`) plus:

```js
module.exports = {
  id, extent, hole, surfaces, height, trees, woods, props, obLine, probes, sea,
  stage: {
    number: 4, role: 'match' | 'tiebreak', order: 4,     // order: 1..9 for match, 1..3 for tiebreak
    name: 'Volcano Drop', theme: 'volcano',
    origin: { lat, lon },            // open ocean; latitude and longitude pick sun and sky
    conditions: 'calm' | 'breezy' | 'windy',   // optional
    baseM: 0,                        // optional altitude
    timeOfDay: 'day' | 'golden' | 'dusk' | 'night',   // a hint for the look stream; default 'day'
    blurb: 'One swing from the crater rim to an island in the lava.',   // under 90 characters, shown on the stage intro
    difficulty: 1 | 2 | 3,
  },
};
```

holes-c makes `courses.js` discover every file in `holes/` that has a `stage` and build one
single-hole course per stage (plus the legacy `arcade-classics`). The course JSON carries

```js
course.arcade = { id, formatVersion: 2, generator, holes: [id], theme, role, order, timeOfDay, blurb, difficulty, conditions? }
```

and `build.mjs` also writes the tour manifest to `<dataDir>/arcade-tour.json`:

```json
{ "version": 1,
  "stages":    [ { "id": "lagoon-island", "order": 1, "number": 1, "file": "osm-node-9900000000001.json", "name": "Lagoon Island", "par": 3, "lengthYd": 150, "theme": "tropical", "timeOfDay": "day", "blurb": "...", "difficulty": 1 } ],
  "tiebreaks": [ { "id": "bullseye-bay", "order": 1, "number": 21, "file": "osm-node-9900000000021.json", "name": "Bullseye Bay", "par": 3, "lengthYd": 115, "theme": "tropical", "timeOfDay": "day", "blurb": "..." } ] }
```

A stage whose hole file does not exist yet is simply absent from the manifest; consumers
must cope with fewer than nine stages and zero to three tiebreaks.

### Themes and props (look stream renders, hole streams use)

Themes: `tropical`, `canyon`, `links`, `volcano`, `alpine`, `sakura`, `jungle`, `desert`,
`neon`, `stadium`. The look stream reads `course.arcade.theme` and `timeOfDay` (delivered to
the client in course geometry; add them to `courseGeometry()` in `server.js` as
`arcade: course.arcade || null`) and gives each theme its own palette: turf, rough, sand,
water (`volcano`: glowing lava; `alpine`: ice blue; `neon`: black water with neon reflections),
sky and light, fog, and how `course.trees` are drawn (palms / red-rock scrub / pines with snow
/ cherry blossom / jungle canopy / sparse desert palms / lit city trees).

Prop kinds (`L.prop(kind, x, y, { heightM, rotDeg })`, scenery only, no collision). The look
stream builds every one of these, procedurally in three.js (low-poly, bold, readable from
300 yd) or as a GLB; hole streams may use only these kinds:

`lighthouse`, `palm`, `volcano`, `rock-arch` (exist), `cactus`, `mesa`, `pine`, `snowman`,
`cabin`, `ice-spire`, `lava-rock`, `lava-fall`, `sakura-tree`, `torii`, `pagoda`,
`stone-lantern`, `bridge`, `temple`, `idol`, `pyramid`, `obelisk`, `sphinx`, `skyscraper`,
`neon-sign`, `billboard`, `grandstand`, `floodlight`, `target-ring`, `balloon`, `blimp`,
`windmill`, `shipwreck`, `crystal`, `torch`, `flag-banner`.

Notes: `heightM` is the model's real height. `target-ring` lies flat on the ground: `heightM`
is its DIAMETER (use several concentric ones round a tiebreak pin). `balloon` and `blimp`
float: the look stream lifts them (about 60 m and 120 m above their ground point). `bridge`
spans along its `rotDeg` heading with `heightM` as its LENGTH. holes-c adds these kinds to
`PROP_KINDS` in `lib.js` first thing so the other hole streams validate.

## 2. Shot callouts and balls (arcade-core produces, arcade-hud shows, voice speaks)

Every graded shot carries one callout, the single loudest thing to say about it:

```js
result.arcade.callout = { id: 'slice-house', text: 'SLICE HOUSE!', tone: 'funny', voice: 'slice-house' } // or null
```

`tone`: `epic` | `good` | `neutral` | `bad` | `funny`. `voice` is a voice line id (section 3).
arcade-core owns the rules and thresholds and exports `CALLOUTS` (id -> { text, tone }) from
`lib/arcade.js`; the snapshot carries it as `callouts`. The id list is fixed here so the
voice stream can record it today:

| id | text | When (arcade-core tunes the exact numbers) |
| --- | --- | --- |
| `hole-in-one` | HOLE IN ONE!!! | ace |
| `holed-out` | HOLED OUT! | full shot holed from the fairway |
| `chip-in` | CHIP IN! | holed from off the green inside 40 yd |
| `drained` | DRAINED IT! | long putt holed |
| `in-the-hole` | IN THE HOLE! | any other holed putt |
| `pin-seeker` | PIN SEEKER! | approach finishes inside 3 ft |
| `dart` | DART! | approach inside 10 ft |
| `dance-floor` | ON THE DANCE FLOOR! | reaches the green from over 100 yd |
| `bomb` | ABSOLUTE BOMB! | huge drive (carry 290+ or well over the club) |
| `striped` | STRIPED IT! | dead-straight tee shot on the fairway |
| `perfect` | PERFECT SHOT! | grade PERFECT with none of the above |
| `great-shot` | GREAT SHOT! | grade GREAT |
| `nice-shot` | NICE SHOT! | grade GOOD |
| `blast-off` | BLAST OFF! | a rocket-type ball |
| `robbed` | ROBBED! | lip-out: a moving ball crosses the cup edge and stays out |
| `so-close` | SO CLOSE! | a putt or chip that stops within a foot |
| `terrible` | TERRIBLE! | full shot finishes more than 30 yd off line (and no funnier one applies) |
| `slice-house` | SLICE HOUSE! | tee shot more than 30 yd right with slice spin |
| `hook-city` | HOOK CITY! | tee shot more than 30 yd left with hook spin |
| `shank` | SHANK-A-POTAMUS! | starts wildly off line (HLA over about 20 degrees) |
| `worm-burner` | WORM BURNER! | full swing that never gets off the ground |
| `sky-ball` | SKY BALL! | tee shot straight up, goes nowhere |
| `chunk` | CHUNK CITY! | fat: far short of the club's distance |
| `splash` | IN THE DRINK! | water |
| `lava` | MELTED! | water on a `volcano` stage |
| `ob` | SEE YA! | out of bounds |
| `beach` | BEACH DAY! | bunker |
| `timber` | TIMBER! | hit a tree |
| `on-fire` | YOU'RE ON FIRE! | streak reaches 3 |
| `unstoppable` | UNSTOPPABLE! | streak reaches 5 |

The existing `grade`, `label`, `tags`, `reasons`, `points` stay. arcade-hud leads its shot
banner with the callout text when there is one (tone picks the colour and animation) and
calls `audio.say(callout.voice)`.

### Balls

arcade-core grows the catalogue (keep the seven that exist) into something worth collecting
and exports it in the snapshot's `powerups` as
`{ id, name, emoji, rarity, tagline, kind: 'ball' | 'trick', color }`. `kind: 'trick'` is a
sabotage played on the OPPONENT's next shot in a match (it is never armed on your own ball).
Wanted, tune freely: `fireball` (hot and long with a huge run-out), `ghost` (flies through
trees), `skipper` (skips across water like a stone), `yoyo` (rips back with spin),
`homing` (bends toward the pin in flight), `titan` (+25 % speed, no curve), `feather`
(floats: big carry, soft landing), `gold` (double points and coins), and tricks `gust`
(a 25 mph crosswind on the opponent's shot), `tiny-cup` (their cup shrinks), `fog`
(the HUD hides their yardages). Each needs: physics that is real in `lib/physics.js`, a test,
a colour for its trail.

`arcade.shotMods(powerupId, { curses: ['gust'] })` returns the mods for a shot including
any curses against the shooter (the match engine passes them). Solo play keeps the bay
inventory, arming and `unlimited` exactly as they are.

## 3. Voice and sound (voice stream produces, HUD and match UI call)

ElevenLabs key: environment `ELEVENLABS_API_KEY`, else a line `ELEVENLABS_API_KEY=...` in
the env file named by `BIRDIE_VOICE_ENV`, else in a git-ignored `.env` in the repo root.
Read it at run time; never print it, never write it into this repo, never put it in a URL.
Do NOT download or copy audio from any other game (copyrighted): every sound is
generated or original.

Announcer lines are pre-rendered mp3s: `public/arcade/voice/<pack>/<id>-<n>.mp3` (2 to 3
takes per line for variety) with `public/arcade/voice/<pack>/manifest.json`
`{ pack, voice, lines: { '<id>': { text, files: ['slice-house-1.mp3', ...] } } }`.
Default pack `announcer`. Line ids: every callout id above, plus the match lines:

`m-versus` VERSUS! · `m-player-1` PLAYER ONE · `m-player-2` PLAYER TWO · `m-get-ready` GET READY!
· `m-tee-off` TEE OFF! · `m-youre-up` YOU'RE UP! · `m-wins-the-hole` WINS THE HOLE! ·
`m-wins-the-match` WINS THE MATCH! · `m-player-1-wins` PLAYER ONE WINS! · `m-player-2-wins`
PLAYER TWO WINS! · `m-knockout` KNOCKOUT! · `m-must-hole` MUST MAKE THIS! · `m-sudden-death`
SUDDEN DEATH! · `m-closest-to-the-pin` CLOSEST TO THE PIN! · `m-all-square` ALL SQUARE! ·
`m-match-point` MATCH POINT! · `m-final-hole` FINAL HOLE! · `m-flawless` FLAWLESS VICTORY! ·
`m-comeback` WHAT A COMEBACK! · `m-champion` CHAMPION! · `m-quick-match` QUICK MATCH ·
`m-best-of-3` BEST OF THREE · `m-best-of-9` BEST OF NINE · `m-hole-1` .. `m-hole-9` HOLE ONE ..
HOLE NINE · `m-takes-the-lead` TAKES THE LEAD! · `m-sabotage` SABOTAGE! · `m-new-record`
NEW RECORD! · `stage-<stage id>` the stage name (twelve of them) · `pu-<powerup id>` the
ball's name shouted ("ROCKET BALL!").

Audio API additions on `ArcadeAudio` (all no-ops and never throwing when audio is locked,
disabled or a clip is missing):

```js
audio.say(line, { priority = 1, gapMs = 120 } = {})
//  line: 'slice-house' | ['m-player-1', 'm-wins-the-match'] | [{ name: 'Alex', fallback: 'm-player-1' }, 'm-wins-the-match']
//  Lines queue and play one after another, never overlapping. A higher priority clears the queue
//  and cuts in. A random take is chosen each time, never the same take twice running.
//  { name } plays that player's name if a clip exists (see below), else the fallback line.
audio.stopVoice()
audio.cue(name, { intensity })     // unchanged; new one-shot cues listed below
```

Player names: `POST /api/voice/name { name }` renders the name once with the same voice into
`<dataDir>/voice/names/<slug>.mp3` (served at `/voice/names/<slug>.mp3`, `GET /api/voice/names`
lists them). No key or no network: `{ ok: false }` and the fallback line is used. The match
lobby calls it when a match starts. `lib/voice.js` holds this; `server.js` gets one hook line.

New one-shot SFX cues (generated, short, never looped; the mp3 override in
`public/arcade/sfx/<cue>.mp3` already exists as a mechanism): `crowd-roar`, `crowd-cheer`,
`crowd-ohh` (the big near-miss OHHHH), `crowd-aww`, `crowd-gasp`, `crowd-laugh` (for the
funny callouts), `applause`, `whoosh` (screen transitions), `vs-slam` (the VS screen hit),
`drumroll` (under 3 s, tiebreak), `fanfare-win` (match winner, under 6 s), `fanfare-hole`
(hole won, under 3 s), `sting-fail`, `sting-knockout`, `countdown-beep`, `chest-open`,
`coin-burst`, `trick-cast`. Existing cue names keep working.

## 4. Match v2 (match-engine produces, match-ui shows)

Formats: `quick` (one hole), `bo3` (first to 2), `bo9` (first to 5, "Tournament"). No betting
by default: `stakes: null` is a friendly match (the old tiers stay as an optional extra).

Rules:
- Each hole is a stage from the tour manifest. `quick`: the stage chosen in the lobby or
  random. Series: tour order from stage 1, or shuffled (`order: 'tour' | 'shuffle'`), never
  repeating a stage inside a match. `stage: 'current'` keeps the old behaviour (play the
  course that is loaded; legacy same-hole shootout if there is no tiebreak arena).
- First to hit on hole one: random (the VS screen shows the coin flip). After that the
  winner of the previous hole has the honour. After the tee shots: farther from the hole
  plays first (as today).
- **Knockout (automatic loss)**: the moment a player can no longer tie the hole, it is over.
  A is in with N strokes; B is out and has already taken N: B loses on the spot. B has taken
  N-1: B gets exactly one swing and must hole it (`mustHole: true` on that player). Also a
  stroke cap of par + 3: reaching it without holing out loses the hole (both capped: tied).
- **Tied hole**: with `tieRule: 'shootout'` (default) every tied hole is settled at once by
  SUDDEN DEATH, closest to the pin: one ball each on a tiebreak arena (random, not repeated
  until all are used). Nearest wins the hole. Water or out of bounds is a miss and loses to
  any ball on land. Both miss, or within 0.1 ft: again, other player first. With
  `tieRule: 'halve'` tied holes are halved and only a level match at the end goes to sudden death.
- Power-ups in a match: `powerups: 'loadout'` (default): each player has charges for the
  match (quick 2, bo3 3, bo9 6) and may spend one on ANY ball or trick in the catalogue, each
  id once per match. `'unlimited'`: no limits. `'off'`: none. The bay's solo inventory is not
  touched by match shots. Tricks land on the opponent's next swing.
- No mulligans. Either player can concede. Optional `hazardLosesHole`.

Phases (server is the authority; the client shows screens for them):

```
'loading'      the stage (or arena) course is being activated; swings are ignored
'intro'        loaded; waiting for POST /api/match/ready (client sends it when its intro
               screens end; the server readies itself after 25 s as a safety). Swings ignored.
'play'         the hole is being played
'tiebreak'     sudden death on an arena
'hole-result'  a hole was decided; waiting for POST /api/match/continue (the client sends it
               from the result screen: button, or auto after about 8 s; server safety 60 s).
               Then 'loading' the next stage, or the arena when the hole was tied.
'done'         the match is over (result screen); POST /api/match/abort dismisses it
```

A tied hole under `tieRule: 'shootout'` goes `'hole-result'` (with `lastResult.reason:
'tied'` and `nextStage.kind: 'tiebreak'`) then `'loading'`, `'intro'`, `'tiebreak'`; when the
tiebreak is decided the hole's result is rewritten (`reason: 'tiebreak'`, `winnerId`) and the
match goes to `'hole-result'` again, or `'done'`.

State (`GET /api/match`, SSE `match`; `null` when there is no match). Existing fields stay
unless replaced here:

```js
{
  id, seq,                                    // seq: increases with every change
  format: 'quick' | 'bo3' | 'bo9', formatLabel: 'Quick Match' | 'Best of 3' | 'Best of 9',
  target: 1 | 2 | 5, maxHoles: 1 | 3 | 9,
  stakes: null | { tier, tierLabel, entryFee, pot },
  options: { tieRule, powerups, order, hazardLosesHole, strokeCap: 3 },
  phase, currentPlayerId,
  holeNumber: 2,                              // 1-based hole of the match being played
  stage: { id, name, par, lengthYd, theme, timeOfDay, blurb, difficulty, kind: 'match' | 'tiebreak' | 'current' },
  nextStage: null | { ...same },              // set during 'hole-result' and 'loading'
  honourId,                                   // who tees off first on this hole
  players: [{
    id, name, initials, slot: 1 | 2,          // slot: PLAYER ONE / PLAYER TWO
    strokes, lie, holed, ball, distToPinYd,
    holesWon, holeScores: [3, null, ...],
    mustHole: false, capped: false,
    charges: 2, usedPowerups: ['rocket'], armedPowerup: null, cursedWith: null,   // cursedWith: a trick waiting for their next swing
    tiebreakFt: null,                         // this tiebreak round's distance; null: not hit or a miss
    stats: { shots, longestDriveYd, closestFt, bestGrade, perfects, points, callouts: ['bomb', ...] },
    profile: { trophies, rank, wins, losses, streak, bestStreak },   // from the server's ledger
  }],
  holeResults: [{ holeNumber, stageId, stageName, par, winnerId, reason, scores: {id: strokes}, tiebreak: null | { arenaId, rounds: [{ [id]: ft | null }] } }],
  //   reason: 'score' | 'knockout' | 'cap' | 'hazard' | 'tiebreak' | 'halved' | 'tied' (tiebreak still to come)
  lastResult: null | { ...the newest holeResults entry },   // what the hole-result screen shows
  tiebreak: null | { arenaId, round, pending: [ids], results: [{ round, playerId, ft, miss: null | 'water' | 'ob', holed }] },
  standings: 'ALL SQUARE' | 'Alex 1 UP', matchPoint: null | playerId | 'both',
  winnerId, loserId, reason,                  // reason once done: 'holes' | 'tiebreak' | 'concede'
  rewards: null | { winner: { trophies, coins, chest: ['fireball', 'ghost'] }, loser: { trophies } },
  awards: null | [{ id: 'longest-drive', label: 'LONGEST DRIVE', playerId, value: '301 yd' }],   // once done
  events: [{ seq, type, ... }],               // the last 12; the UI plays what it has not seen
  turnStartedAt, startedAt, log, aborted, concededBy,
}
```

Event types (each carries `playerId` where it makes sense): `match-start`, `coin-flip`
(`winnerId`), `stage-loaded`, `ready`, `turn` (`playerId`), `must-hole`, `powerup-armed`
(`id`), `trick-cast` (`id`, `targetId`), `hole-won` (`winnerId`, `reason`), `hole-tied`,
`tiebreak-start`, `tiebreak-shot` (`ft`, `miss`), `tiebreak-again`, `match-point`,
`match-over` (`winnerId`, `reason`).

Routes (all answer `{ ok, match }` or `{ ok: false, error }`):

| Route | Body |
| --- | --- |
| `GET /api/match` | `{ ok, match, tour: <manifest or null>, tiers, profiles: { id: profile } }` |
| `POST /api/match/start` | `{ playerIds: [a, b], format, stage?: '<id>' or 'random' or 'current', order?, tieRule?, powerups?, stakes?: null or tier, hazardLosesHole? }` |
| `POST /api/match/ready` | `{}` intro screens are done: tee off |
| `POST /api/match/continue` | `{}` leave the hole-result screen |
| `POST /api/match/arm` | `{ playerId, id or null }` a ball for that player's next shot, or a trick against the opponent |
| `POST /api/match/concede` | `{ playerId }` |
| `POST /api/match/abort` | `{}` also dismisses a finished match |
| `POST /api/match/rematch` | `{}` same players and options, a new match |

The match shot's `shot` event keeps `result.match = { playerId, event, ... }`. The client
holds a `match` state that arrives while a ball is in the air until the ball has stopped
(already wired in `app.js` as `flushMatch`).

### Client contract between match-ui, arcade-hud and app.js

```js
new MatchUI({ hud, fetchJson, toast, audio, shotClock })   // audio: the ArcadeAudio or null
matchUI.onMatch(state | null)
matchUI.setPlayers(roster)            // unchanged
matchUI.openLobby()
arcadeUI.setMatch(state | null)       // arcade-hud: while a match is in play the ball dock shows the
                                      // loadout of whoever is up (charges, used ids, tricks) and arms
                                      // through POST /api/match/arm instead of /api/arcade/arm
```

Screens match-ui builds (full-bleed, animated, readable from 4 m away because the players
are standing at a hitting mat, not sitting at the screen): lobby (two big player slots,
format cards, stage picker with stage art colours, options tucked away), VS screen with the
coin flip, stage intro (hole number, name, par, yards, blurb), turn banner ("ALEX, YOU'RE
UP" with what they need: "FOR BIRDIE", "MUST MAKE THIS"), in-play VS header with series
pips, knockout / hole-won screen, SUDDEN DEATH intro and the closest-to-the-pin duel board,
match-point flash, and the winner screen: "ALEX WINS!" (or PLAYER 1 WINS), confetti,
awards (longest drive, closest, shot of the match), trophies and chest reveal, Rematch /
New match / Exit. Every screen must also work with no audio and must never block a swing
longer than it needs: the players are waiting with a club in hand.

## 5. Addenda (fixed so streams agree)

- **Power-up ids and spoken names** (ids are final; arcade-core tunes the physics, voice
  records `pu-<id>`): `rocket` ROCKET BALL! · `sticky` STICKY BALL! · `magnet` MAGNET BALL! ·
  `windcutter` WIND CUTTER! · `laser` LASER BALL! · `moonball` MOON BALL! · `bouncy` BOUNCY
  BALL! · `fireball` FIREBALL! · `ghost` GHOST BALL! · `skipper` SKIPPER! · `yoyo` YO-YO BALL!
  · `homing` HOMING BALL! · `titan` TITAN BALL! · `feather` FEATHER BALL! · `gold` GOLDEN
  BALL! · tricks: `gust` GUST! · `tiny-cup` TINY CUP! · `fog` FOG!
- **`lib/arcade.js` exports for the match engine** (arcade-core provides, match-engine calls
  defensively with `typeof` checks until it lands): `POWERUPS` (array of
  `{ id, kind: 'ball' | 'trick', ... }`), `arcade.shotMods(id, { curses })`,
  `arcade.grantBalls(ids)` (adds to the bay inventory, persists, returns the snapshot),
  `arcade.addCoins(n)`. In a match the server builds the shot's mods with
  `arcade.shotMods(armedId, { curses })` and never calls `consumeArmed()`.
- **Fog trick**: while the player who is up has `cursedWith: 'fog'`, arcade-hud puts the
  class `arc-fog` on `#hud` (hides every yardage readout, draws a fog vignette).
- **Challenges (stretch, arcade-core + arcade-hud)**: snapshot
  `challenges: [{ id, text, progress, goal, done, reward: { coins, balls: [ids] } }]`, three
  live at a time, replaced when claimed; the HUD shows them only if the field is present.
- **Rocket holes** (added after user feedback: "crazy courses where you need that extra
  rocket to even get up there"). A stage may set `stage.freeBall: 'rocket'` (any ball id).
  It is carried as `course.arcade.freeBall` and in the manifest entry as `freeBall`. On such
  a stage EVERY player's tee shot (the hole's first stroke) is played with that ball for
  free: no charge, no inventory, not counted in `usedPowerups`, and a ball the player armed
  themselves is kept for later instead. This applies in matches and in solo play (the
  server's `playShot` does it; match-engine owns that). The match state's `stage` carries
  `freeBall`; match-ui shows "ROCKET HOLE: FREE ROCKET BALL ON THE TEE" on the stage intro
  and the turn banner. Extra stages beyond the nine have `order` 10 and up: tour order uses
  orders 1 to 9 for `bo9`; shuffle and the quick-match picker draw from every stage.
- **Second wave of prop kinds** (added for the detail pass; already in `PROP_KINDS`):
  `waterfall`, `castle`, `dragon`, `giant-tree`, `ruins`, `jumbotron`, `fireworks`, `cloud`,
  `airship`, `statue`, `fountain`, `tiki`, `hut`, `boat`, `gate`, `tower`, `rock-spire`,
  `launch-ramp`, `crowd`, `bird-flock`. `fireworks`, `cloud`, `airship` and `bird-flock`
  float (allowed anywhere, lifted by the renderer). `crowd` is a block of spectators about
  `heightM` tall and four times as wide. A kind with a file in
  `public/arcade/props/manifest.json` (`{ kinds: { '<kind>': { file: '<kind>.glb' } } }`) is
  drawn from that GLB; otherwise the look stream's procedural model is used.
- **Routes** (from play-testing: several ways to the hole, some risky, some not). Every match stage has at least THREE distinct, visible
  routes: a SAFE one (wide, longer, no forced carry), a RISKY one (a carry or a narrow gap
  that saves a shot when it comes off and costs one when it does not) and a ROCKET one (a
  shelf, tier or far target only a boosted ball reaches, worth an eagle or birdie look). A
  hole file documents them in `hole.routes: [{ id: 'safe' | 'risky' | 'rocket', name, note }]`
  (carried to `course.holes[0].routes` and shown on the stage intro).
- **Two more voice lines** (match stakes; stream wind added the banner, voice records them;
  until the clips exist the audio layer plays nothing for them): `m-for-the-win` FOR THE
  WIN! · `m-to-tie` TO TIE! Said after the player's name when their putt or chip is to win
  or to tie the hole (`say: [{ name, fallback: 'm-player-N' }, 'm-for-the-win']`), with one
  `heartbeat-hit` under the banner.
- **Match menu and stakes** (user: "I can't restart or quit a match"; "putt in to win").
  Routes `POST /api/match/undo`, `/restart-hole`, `/restart`; state `undoable`,
  `canRestartHole`, per player `shotFor: 'win' | 'tie' | 'lead' | null` and `shotKind:
  'putt' | 'chip' | 'shot' | null`; events `stray-shot`, `shot-undone`, `hole-restarted`,
  `clutch` on `hole-won` / `hole-tied`. On the green the player with fewer strokes putts
  first. All in `docs/match.md`.
- **Wind per hole** (user: "each hole should have variable wind rates, just like golf
  clash"). A stage may set `stage.wind: { min, max }` in mph (carried to `course.arcade.wind`
  and the manifest entry). Without it the range comes from `conditions`: `calm` 0 to 5,
  `breezy` 6 to 12, `windy` 12 to 22. Every time a stage comes up (a match hole, a tiebreak
  arena, or the course being loaded in solo play) the server ROLLS the wind for that hole: a
  speed inside the range and a random direction, the same for both players for the whole
  hole, re-rolled for the next hole. In a series the roll leans toward the top of the range
  as the match goes on. The match state's `stage` and `nextStage` carry
  `wind: { mph, dirDeg, cross: 'L' | 'R' | null, along: 'head' | 'tail' | null, label }`
  (direction relative to the tee-to-pin line) and the stage intro shows it big.
- **Crowd on callouts** (arcade-hud): `epic` -> `crowd-roar`, `good` -> `crowd-cheer` or
  `applause`, a near miss (`robbed`, `so-close`) -> `crowd-ohh`, `bad` -> `crowd-aww`,
  `funny` -> `crowd-laugh`. One-shots only.
