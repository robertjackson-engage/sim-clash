# The modes: Party, handicaps, Bullseye, Trick Shot Duel, replays and highlights

More things to do with real swings in a bay, each a first-class entry of the main menu
(`docs/sim-clash-shell.md`), each with the same kind of screens, menu, undo and way out as
VERSUS. This file is how they are built; the player's guide is `docs/arcade-v2.md`.

| Mode | Players | Where the rules live | The screens |
| --- | --- | --- | --- |
| **PARTY** (skins, stroke race, elimination) | 2 to 4 | `lib/match.js` (the match engine, generalised) | `public/arcade/party.js`, `party.css` |
| **Handicaps** (HELP 1 to 3) | versus and party | `lib/match.js` | both lobbies |
| **BULLSEYE** | 1 to 4 | `lib/bullseye.js`, `lib/bullseye-mode.js` | `public/arcade/bullseye.js`, `bullseye.css` |
| **TRICK SHOT DUEL** | 2 | `lib/duel.js`, `lib/duel-mode.js` | `public/arcade/duel.js`, `duel.css` |
| **Instant replay, HIGHLIGHTS** | any | `lib/highlights.js`, `lib/highlights-mode.js` | `public/arcade/replay.js`, `replay-core.js`, `highlights.js`, `replay.css` |

Every edit to a file these modes share with the rest of the game is marked `v3:modes`.

## How a mode plugs in

Two ways, depending on what the mode is.

**A format of the match engine** (PARTY). The match engine already had everything a hot-seat
game needs (stages, wind, loadouts and tricks, the stake of a swing, undo, restart, the drop
on the line, the stray-ball guard, rocket holes, profiles and rewards, a driver in
`server.js`), so a party is the same engine playing a format for two to four. Its state
arrives on the same `match` event, its routes are the match's, and its UI is a subclass of
the match UI. Nothing was forked.

**A mode of its own** (Bullseye, the duel, the highlights reel). `server.js` keeps a small
registry: a mode is a file `lib/<id>-mode.js` exporting `create(ctx)`, registered with one
line (`registerMode('./lib/<id>-mode')`; a file that is not in the build is skipped
quietly). To the server a mode is

```js
{ id,                      // names its routes (GET /api/<id>, POST /api/<id>/<action>), its event
                           // ('<id>': its state, on connect and after every change) and its mark
                           // on a shot (result[id])
  label,                   // for messages ("A Bullseye game is in play")
  active,                  // (getter) a game of this mode has the bay: every swing is its own
  state(),                 // what the event and GET /api/<id> carry (null: no game)
  info(),                  // optional: more for GET /api/<id> (high scores, arenas ...)
  drop(),                  // end the game and let go of the bay (safe when there is none)
  beforeShot(game),        // a swing arrived: null drops it, else { armed?, curses?, putting?, free? }
  afterShot(game, result), // the game played it: what is returned rides on the shot as result[id]
  handle(action, body),    // POST /api/<id>/<action>; throws ctx.ModeError(message, status) to refuse
  onShot(result, about) }  // optional: every shot the bay plays, in any mode (the highlights reel)
```

and `ctx` gives it the game, the arcade layer, the roster, the data dir, `broadcast`,
`tour()` (the Clash Tour manifest), `profile(id)`, `player(id)`, `takeBay(id)` (drops a match,
a solo run, a practice game and every other mode), `loadStage(file)` (puts a stage's course
in the bay on its tee with a wind of its own; resolves null or the reason it would not
load), `wind()`, `changed(id)`, `busy()` and `setGamePlayer()`.

A match, a solo run and the modes are **one at a time**: starting any of them drops the
others. While a mode's game has the bay, `/api/drop`, `/api/mulligan` and `/api/next-hole`
answer 409, as they do in a match. The swing gate (a page in its menus holds every swing) is
in front of all of them.

On the page a mode of its own is a module `public/arcade/<id>.js` exporting `mount(ctx)`;
the shell imports it (a 404 simply means no entry in the main menu) and follows it exactly
as it follows the match UI: `ui.lobbyOpen` is the menu screen `<id>` (swings held),
`ui.live` is play (`html.sc-mode-<id>`), neither is the main menu. The module draws in its
own root (class `md-root`, inside `#hud`), reads its own keys and calls `ctx.sync()` when
either flag changes. The contract is in the comment above `Shell._loadModes()`.

## Four players, four colours

| Slot | Colour | Mark |
| --- | --- | --- |
| 1 | `#ff5a36` (the hot orange-red the game has always had) | ● |
| 2 | `#2e9bff` (the electric blue) | ◆ |
| 3 | `#2fe6a8` (mint) | ▲ |
| 4 | `#f277d0` (pink) | ■ |

Slots 3 and 4 were picked to stay apart from the first two, from each other and from the
gold of a win under the three common kinds of colour blindness (candidates were scored by
the smallest CIELAB distance between any two of the set under simulated protanopia,
deuteranopia and tritanopia: 18.8 for this set; white scored higher but is the text colour)
and on a washed-out projector. Colour is never the only cue: a slot always shows its number
and its own mark with it (a header card, a row of a result, a dart on the Bullseye board).
`PLAYER_COLORS`, `PLAYER_MARKS`, `slotColor`, `slotMark` in `public/arcade/shell-core.js`.

## Party (2 to 4 players)

`POST /api/match/start { playerIds: [2 to 4 roster ids], format: 'skins' | 'stroke' | 'elim',
holes?: 3 | 6 | 9, help?, powerups?, order?, putting?, hazardLosesHole?, stage? }`. Everything
`docs/match.md` says about a match holds unless this section says otherwise; a party is always
a friendly (no stakes).

### The three formats

- **Skins.** Every hole is worth a skin. The lowest score ALONE takes it; a tie (or nobody
  holing out) carries it over, so the next hole is worth two. A tie on the LAST hole is
  settled at once by sudden death on an arena, between the players who tied, for everything
  that is left. Most skins wins; level on skins when the holes run out is a sudden-death
  playoff between those level (it decides the game, it is no skin). The game ends the moment
  it is won (a lead bigger than the skins that are left).
- **Stroke race.** 3, 6 or 9 stages; every stroke counts; the lowest total wins. A player who
  reaches the stroke limit (par + 3) without holing out stops, and the hole counts one more
  (par + 4). Level on strokes: the most arcade points wins (`reason: 'points'`); level on
  both: a sudden-death playoff.
- **Elimination.** The highest score on each hole is OUT. A tie for the highest goes to an
  arena: closest to the pin, and the FARTHEST ball goes (a ball in the water or out of
  bounds is farther than any ball on land; those level at the far end go again while the
  others are safe). One hole per player but one; the last two play the final as a
  head-to-head.

### Order of play

The first tee is drawn (`coin-flip` carries `order`); after that the tee is played in the
order of the last hole's scores, best first (`teeOrder`, `honourId` its first). Off the tee
whoever is **farthest from the hole** plays, among those still playing it (level: fewer
strokes, then the tee order). **On the green**, once every ball still in play is on it, the
player with the **fewest strokes putts first**, as in a head-to-head: the leader's putt is
then for the hole, and a make sweeps up everybody who can no longer tie it. Not in a stroke
race, where there is no knockout: there the farthest putts first, as golf has it.

### Out of the hole

The knockout rule for more than two: a player who can no longer matter to the hole picks up
at once (`pickedUp`, a `picked-up` event), so the bay keeps moving.

- **Skins**: a score is in, and a player has already taken at least that many strokes: they
  cannot tie it. A player lying exactly one fewer has one swing that must drop (`mustHole`,
  `shotFor: 'tie'`: PUTT IN TO STAY ALIVE).
- **Elimination**: the last player still out, already sure to be the highest alone. One
  stroke better than the worst score that is in: one swing, to stay alive (a make is a tie
  for the highest: sudden death).
- **Stroke race**: nobody. Only the stroke limit stops a player.

With `hazardLosesHole` a ball in the water or out of bounds is out of the hole at once.

### What a swing is for

`shotFor` / `shotKind` on the player who is up, as in a match, read for the field:

| Format | `win` | `tie` (the must-make) | On screen |
| --- | --- | --- | --- |
| skins | holing it takes the skin at once (nobody left could tie it) | holing it ties the best score that is in | PUTT IN TO WIN THE HOLE · PUTT IN FOR 3 SKINS · PUTT IN TO STAY ALIVE |
| elim | holing it leaves the one other player still out sure to be the highest (the final: wins the game) | the last one out, one better than the worst score in | PUTT IN TO KNOCK OUT SAM · TO WIN THE GAME · TO STAY ALIVE |
| stroke | the last player on the last hole: holing it wins the race on the totals | ... ties it (a miss is no knockout: `mustHole` stays false) | PUTT IN TO WIN THE RACE · TO TIE THE RACE |

`lead` (skins: holing it puts somebody on a must-make) is in the state and is not shouted.
As in a match a full shot gets its line only when it is the last word or beats a score that
is already in.

### Every mechanic, for N

- **Loadouts and tricks.** Charges by the length of the game (3 holes 3, 6 holes 4, 9 holes 6;
  elimination 2 / 3 / 3 for two / three / four players). A trick is cast on ONE chosen
  opponent: `POST /api/match/arm { playerId, id, targetId }` (also through
  `/api/arcade/arm`). With no `targetId` it lands on whoever is doing best among the
  opponents who carry no curse (skins: most skins; a stroke race: fewest strokes; elimination:
  fewest on the hole; level: the tee order). On the page the player who is up sees SABOTAGE
  GOES TO with the opponents' names (key **X** or a tap changes it) and the ball dock casts
  on that one. A player who is out arms nothing and is nobody's target.
- **Undo, restart the hole, the drop on the line, the stray-ball guard, rocket holes, the
  wind, the putting option**: the same routes and the same code as a match. A snapshot is
  the whole party, so an undo takes back a swing that swept two players up and closed the
  hole, or that eliminated a player and ended the game, exactly. A drop's stroke counts at
  once and can sweep its taker out of the hole.
- **Sudden death** takes only the players who are level, in the tee order; the one who led
  off goes last in the next round. `tiebreak.ids` (who is in this round) and
  `tiebreak.goal` (`'best'`: nearest wins, `'worst'`: farthest is out).
- **Leaving** (`POST /api/match/concede { playerId }`, the menu's LEAVE THE GAME): that
  player is out, behind everybody who stays (`left`); the others play on, whoever is next
  comes up, and the last one left wins (`reason: 'concede'`). In an elimination's sudden
  death the player who leaves is the one who goes. Nothing before it can be taken back.
- **Profiles and rewards.** The winner takes the game's trophies (3 holes 20, 6 holes 30,
  9 holes 40; elimination 10 / 20 / 30), the streak bonus, coins (250 / 400 / 600;
  elimination 100 / 250 / 400) and the chest; the player who finished LAST drops half the
  trophies (never below 0); anybody in between keeps theirs. On the record: a win for the
  first, a loss (and the streak ended) for everybody else. `partyRewardsFor()` and
  `applyPartyRewards()` in `lib/match.js` are pure; the server settles every profile and an
  undo of the deciding swing puts every one of them back.

### How the engine was generalised (and what did not move for two players)

`createMatch()` takes a party format and two to four players; the head-to-head formats still
take exactly two and run the code they always ran. The engine branches on `PF` (the party
format) in a handful of places and nowhere else:

| Shared by both, unchanged | Head-to-head only (untouched) | Party only (new) |
| --- | --- | --- |
| stages and their plan, loading, `stageReady` / `stageFailed`, the wind, the one-ball swap (`load` / `capture` / `tidy`), `beforeShot` / `afterShot`, spending balls and curses, the free ball, the stats, the stray mark, snapshots (`undoLastShot`, `restartHole`), `drop`, the events and the log, `abort` / `release`, `config` | `holeDecided`, `closeHole`, `afterHole`, `tiebreakShot`, `finish`, `matchPoint`, `standingsText` for two, the `tieRule`, stakes | `partyNextId` (order of play), `partyStake`, `partySweep` / `pickUp`, `closePartyHole`, `afterPartyHole`, `toSuddenDeath` / `judgeSuddenDeath` / `settleSuddenDeath`, `partyTiebreakShot`, `eliminate`, `finishParty`, `leaveParty`, `trickTarget` |

`test/match.test.js` and the other match suites pass unedited. A head-to-head's state has
exactly the keys it always had: the party fields below are only on a party's state, and
`help` / `teeYd` only on a player who has help.

### State (a party adds)

```js
{ party: 'skins' | 'stroke' | 'elim',      // absent on a head-to-head
  holes, teeOrder: [ids], carry,           // skins carried INTO the hole in play
  skinsAtStake,                            // carry + 1 (skins), else null
  placings: null | [ids],                  // first to last, once it is over
  format: 'skins' | 'stroke' | 'elim', formatLabel: 'Skins · 3 Holes', target: null, maxHoles,
  players: [{ ..., out, left, outOnHole, pickedUp, total /* strokes of a stroke race */, place,
              holesWon /* skins, in a skins game */ }],
  holeResults: [{ ..., party, scores /* skins: strokes taken; else what the hole counts */,
                  finish: { id: 'holed' | 'picked-up' | 'capped' }, skins?, carry?, eliminatedId?, playoff? }],
  tiebreak: { ..., ids, goal },
  winnerId, loserId /* the last place */, reason: 'holes' | 'points' | 'tiebreak' | 'concede',
  rewards: { winner, loser, placings } }
```

Events a party adds: `picked-up { playerId, reason: 'knockout' | 'hazard' }`,
`eliminated { playerId, holeNumber, place, reason }`, `final-two { playerIds }`,
`player-left { playerId }`; `coin-flip` carries `order`, `hole-won` carries `skins` or
`eliminatedId`, `hole-tied` has `reason: 'carry' | 'tied'` with `playerIds` and `goal`,
`tiebreak-again` carries `playerIds`, `match-over` carries `placings`. A shot's
`result.match.event` is still `shot` / `hole-won` / `hole-tied` / `tiebreak-shot` /
`match-over` (a stroke-race hole closes as `hole-won` with `winnerId` the sole best of the
hole, or null).

Routes: the match's own. New: `POST /api/match/suggest { playerIds }` (below);
`GET /api/match` also answers `partyFormats`, `partyHoles`, `helpLevels`.

### The screens (`public/arcade/party.js`)

`PartyUI extends MatchUI` and is the one match UI of the page (`app.js`); every method it
overrides starts by handing a state without `party` to `super`, so a head-to-head is drawn
by the code that always drew it. `match.js` gained only what a subclass in another file
needs (its little pieces of markup exported as `kit`, the menu's items / title / "where"
line as methods, seven number keys for the menu), the HELP rows of its own lobby, and the
winner-screen hook the replays hang on.

- **The lobby** (main menu > PARTY, `?party=1`): four slots in the four colours (two always,
  + ADD A PLAYER for the third and fourth), each with the roster picker over its own card
  and its HELP (OFF, 1, 2, 3, with the level's words under it and the suggestion ringed);
  SKINS / STROKE RACE / ELIMINATION; 3 / 6 / 9 holes and the stages by name; the options
  drawer (power-ups, stage order, hazard, putting); START.
- **The field**: the first intro. Every name in its colour, the format, the draw.
- **The stage card and SUDDEN DEATH**: the match's, with the party's standings strip, the
  forward tees of the hole, who is in the sudden death and whether the nearest wins or the
  farthest goes.
- **In play**: a header that is WIDE AND SHORT: one card per player (mark and number, name,
  strokes, to the pin, their skins / score to par / IN or OUT) either side of the centre
  block (hole, what is at stake, wind). Four cards need more width than a match's two sides,
  and the only free width is above the wind chip and the shot planner, which start 82 px
  down, so the bar is 72 px tall (a match's is 98) and runs from 200 px inside the left edge
  to 200 px inside the right. The tag of whoever is up (UP NOW, PUTT IN TO STAY ALIVE) hangs
  under their card; IN FOR 3 / PICKED UP / OUT under the others. The match's ticker, turn
  banner, menu (GAME MENU: RESUME, UNDO, DROP, RESTART HOLE, RESTART GAME, LEAVE THE GAME,
  EXIT), stray-ball prompt and result countdown are the match's own code.
- **The result of a hole**: ALEX TAKES 2 SKINS / NO WINNER, 2 SKINS ON THE NEXT HOLE /
  JORDAN IS OUT! / the hole's scores, a row per player, the standings, what is next.
- **The winner**: the placings (1ST to 4TH with each figure), the awards, the loot,
  PLAY AGAIN / NEW GAME / EXIT.

## Handicaps (HELP)

So a beginner can play a good golfer. Optional, per player, in both lobbies; three levers,
each visible on screen, offered bundled as levels that each add to the last:

| Level | Putting | Power-ups | Tee |
| --- | --- | --- | --- |
| OFF | the game's | the game's | the back tee |
| HELP 1 | EASY, for that player only | +1 charge | the back tee |
| HELP 2 | EASY | +1 | a FORWARD TEE, 20 % of the hole closer |
| HELP 3 | EASY | +2 | a forward tee, 35 % closer |

Why this order: on a simulator the putting assist is the biggest equaliser for somebody new
(an average putter holes about 7 in 10 from 30 ft on EASY against 4 in 10 on ASSISTED:
`docs/arcade.md` "Putting levels"), a power-up is fun rather than strokes, and length only
starts to matter once the short game is covered. That is a judgement from the numbers, not
yet from beginners playing it.

- `help` on a player of `createMatch` is a level (0 to 3) or the levers themselves
  (`{ charges: 0..3, tee: 0 | 0.1..0.5, putting: 'easy' | 'assist' | 'off' | null }`,
  `normalizeHelp()`); over HTTP `help: { <playerId>: level | levers }` on
  `POST /api/match/start`. A rematch and a restart keep it.
- **Charges** are added to the loadout's (nothing to add with unlimited power-ups or none).
- **The forward tee** (`forwardTee(hole, frac, surfaceAt)`): the spot that fraction of the
  way along the hole's routing line, when it is on MOWN ground (fairway or tee turf), else
  the mown spot on the line nearest to it, looked for from half that far to half as far
  again, two metres at a time, and never within 60 yd of the pin. None: the back tee. On
  the tour every par 4 and par 5 has one at both fractions; the carry par 3s (Lagoon Island,
  Volcano Drop: water or lava all the way) have none, Sakura Garden only at 35 %, Dragon's
  Spine only at 35 %. The stage card says where each helped player starts (`teeYd`: yards to
  the pin from there, null from the back tee). The tee is still played in the tee order, the
  forward tee's first stroke is a first stroke (a rocket hole's free ball rides on it), and
  a sudden death is played from the same spot by everybody.
- **Putting**: `beforeShot` answers `putting` for that player and the server arms the swing
  with it (`shooter.putting || match.putting`).
- **A suggestion, never a setting.** `POST /api/match/suggest { playerIds }` answers
  `{ help: { id: level }, levels }` from the profiles (`suggestHelp()`): one level per rank
  below the best-ranked player in the lobby, up to 3, and one level for a player with fewer
  than three games on the record against somebody with ten or more. The lobby rings the
  suggested level and says SUGGESTED; nothing is applied until somebody presses it. Help is
  kept by player (not by slot), so it follows the player to another slot and is not left
  behind on whoever sits there next.
- On the screens: an **H** and the level beside a helped player's name in the header (a
  match's too), HELP 2 on the field screen, FORWARD TEE · 204 YD on the turn banner and the
  stage card.

### Tests

| File | What |
| --- | --- |
| `test/party.test.js` | 30 tests of the engine: formats, turn order, skins (carry, the last hole, the playoff, the early finish), the stroke race (cap, points, playoff), elimination (out of the hole, sudden death among three, the final), stakes of a swing, tricks with a target, undo / restart / drop / stray / rocket holes for N, leaving, rewards for N, the state shape, the help levels, the forward tee, the suggestion |
| `test/party-server.test.mjs` | the routes on a real server over HTTP: three players, help, a trick with a target through both arm routes, a capped hole into sudden death, the payout to three profiles and its undo, a rematch, leaving, a head-to-head with help |
| `test/party-ui.test.mjs` | 9 tests of the screens' pure helpers: the words of a stake, the cards, the standings, the result of a hole for each format, the menu, the trick's target, the colours |
| `tools/arcade-dev/party-e2e.mjs` | four real games on the built tour over HTTP (skins for four with help, an undo, a restart and a trick; elimination for three; a stroke race for four; a head-to-head with help): some 300 checks (the number moves with how the games go), the order of play asserted on every state |

```
node tools/arcade-holes/build.mjs --out .scratch/modes/data
node tools/arcade-dev/party-e2e.mjs            # its own server on 8358 / 9988, stopped afterwards
```

### Sound

Guarded calls to the existing audio API only. Existing cues and lines are reused wherever
they fit (`m-for-the-win`, `m-must-hole`, `m-youre-up`, `m-sudden-death`, `m-all-square`,
`fanfare-hole`, `fanfare-win`, `sting-knockout`, `sting-fail`, ...). A party's own lines are in
the announcer pack since the second release (`docs/arcade-voice.md`): voice `p-skins`, `p-stroke-race`,
`p-elimination`, `p-to-stay-alive`, `p-for-the-skins`, `p-takes-the-skin`, `p-skin-carries`,
`p-is-out`, `p-the-final`, `p-farthest-is-out`, `p-wins-the-game`, and `m-player-3`,
`m-player-4`, `m-player-3-wins`, `m-player-4-wins` for nameless players in slots 3 and 4.

### Notes and limits

- A party cannot be staked, and has no `tieRule` (skins carry; the other two have no ties
  to halve).
- The forward tee is found on the hole's routing line only. A stage whose line crosses no
  mown ground has none, however far the help level asks for.
- The help levels are bundles; the engine takes the levers one by one, the lobbies do not
  offer them one by one.
- In a stroke race a player far behind still plays every hole out to the stroke limit:
  that is the format.

## Bullseye

Darts with a golf ball: one to four players on one of the three sudden-death arenas, whose
greens are painted as a target. Every ball is hit from the arena's tee and scores by the
ring it **finishes** in. Main menu: BULLSEYE.

| File | What |
| --- | --- |
| `lib/bullseye.js` | `createBullseye`: the rules as a pure, serializable state machine (no I/O, no timers), and `createBullseyeBests`: the high scores and the nearest ball of the night |
| `lib/bullseye-mode.js` | the server side: its driver (the arena into the bay, the tee and dismiss timeouts), its routes, the store; registered with `server.js`'s mode registry (`registerMode('./lib/bullseye-mode')`) |
| `public/arcade/bullseye.js`, `bullseye.css` | the screens (`BullseyeUI`, classes prefixed `be-`); a mode module of the shell (`mount(ctx)`) |
| `test/bullseye.test.js` | 24 tests of the engine and the store |
| `test/bullseye-server.test.mjs` | a whole game on a real server over HTTP (in-process, throwaway data dir) |
| `test/bullseye-ui.test.mjs` | 4 tests of the page's pure parts (what a ball says, the board's SVG) |
| `tools/arcade-dev/bullseye-e2e.mjs` | whole games over HTTP on the built arenas, some 480 checks |

### Rules

- **The target is the arena's own.** The rings are the course's `target-ring` props (centred
  on the pin; `heightM` is the ring's diameter), read when the arena is in the bay
  (`ringsFromCourse`), so the score is what is painted on the ground: Bullseye Bay and Ice
  Pick 3 / 7 / 11 / 15 / 19 m, Thunder Dome 3 / 7 / 12 / 18 m. A ring's line counts as in.
- **What a ring is worth.** The smallest ring is the **bullseye, 50** (a holed ball is one).
  The others are worth **5, 10, 15, 25 counted from the outside in**: five rings read
  50 / 25 / 15 / 10 / 5 from the pin out, Thunder Dome's four 50 / 15 / 10 / 5. So the edge
  of every target is 5, every score is a multiple of 5 and any countdown can be finished.
  Outside the last ring: nothing (the rings reach the edge of the green on all three
  arenas, so "off the target" is off the green). In the water or out of bounds: a **miss**
  (nothing; on the board it is a cross on the rim where the ball was lost).
- **Rounds and turns.** A game is a number of rounds; in a round every player takes a turn
  of N balls one after another (three rounds of three by default; the lobby offers 3 / 5 / 7
  rounds). Round one goes in lobby order; after that **whoever is behind leads off**.
- **HIGH SCORE** (the default): the most points when the rounds run out. With a
  **multiplier**: score with every ball of a turn and they multiply: the second scoring ball
  in a row counts double, the third treble. A ball that scores nothing breaks the run, and
  every turn starts at ×1. Three bullseyes in a turn is 50 + 100 + 150 = 300, the perfect
  turn (the "180").
- **COUNTDOWN** (the "301" game): everybody starts on 100 (or 200, 300) and scores **down**,
  plain ring values (no multiplier: an exact finish has to be something a player can aim
  for, and the header says which ring it is: CHECK OUT: OUTER RING). Landing on exactly
  zero is a **check out**. A ball that would go below zero is a **BUST**: the turn is over
  and the score goes back to what it was when the turn began. Everybody gets the same
  number of turns: the round a player checks out in is played to its end, whoever still has
  a turn may answer, and the check out in the **fewest balls** wins (a player who has already
  thrown as many balls as the best check out took throws no more). It is capped: 6 rounds
  from 100, 10 from 200, 14 from 300; with nobody out, the nearest to zero wins.
- **Level games.** Level on points (or on what is left, or on the balls of a check out): the
  player whose best single ball finished nearest the pin; still level: the game is shared.
- **Every mechanic of the bay still applies**: the rolled wind of the arena (one roll for
  the game, in the header), the arcade's grading, callouts, announcer and crowd on every
  ball (its coins and XP go to the bay's wallet as in solo play), the stray-ball guard (a
  ball under 40 mph off the tee counts but is marked: STRAY BALL? UNDO / COUNT IT, eight
  seconds), undo of the last ball (one level, exactly as it was, also the ball that ended
  the game, and the records it made go back with it), restart. There are no power-up balls
  (it is a game of skill: the ball dock is put away) and no rescue drop (every ball is from
  the tee).
- **Nobody waits.** After a ball is scored it stays where it finished so the picture can
  stay on it; the page asks for the next ball to be teed up once the score has had its
  moment (2.3 s; 3 s for a bullseye or a bust), and a swing that arrives sooner is played
  all the same. The end-of-round board (4 s) and the open board never hold a swing either.
  Swings are ignored only while the arena loads and on the result screen (a stray ball
  cannot close it).

Why these numbers. A mid-handicapper from 105 to 140 yd finishes inside the last ring a
little under half the time and inside the bullseye a few times in a hundred, about 7 points
a ball. Three rounds of three is then a five-minute game for two and ten for four, with
scores from 30 to 150 and room for the one turn that wins it; a countdown from 100 takes
about five turns, which is why it is capped at six rounds. The multiplier makes the third
ball of a good turn the one everybody watches; it stays out of the countdown because a
finish nobody can plan is no finish.

### High scores and the nearest ball of the night

`<dataDir>/bullseye-best.json` (`createBullseyeBests`):

```js
{ version: 1,
  high:      { <arenaId>: { '<rounds>x<balls>': { <playerId>: { score, at, name } } } },   // HIGH SCORE, per shape of game
  countdown: { <arenaId>: { '<target>': { <playerId>: { balls, at, name } } } },           // fewest balls to check out
  nearest:     { ft, playerId, name, arenaId, arenaName, at, night },                      // the nearest ball of the night
  nearestEver: { ... } }                                                                   // ... and of all time
```

A guest is `_guest`. A "night" turns over at six in the morning, local time (a session past
midnight is the same night); the first ball of a night sets the record quietly, a ball that
beats it is announced (NEAREST THE PIN TONIGHT!). Any dry ball counts, in either game.
`snapshot()` / `restore()` put the store back when a ball is undone.

### The screens (`public/arcade/bullseye.js`)

- **Lobby**: four slots in the four player colours and marks (keys 1 to 4: add, change,
  drop out; a player is made on the spot when the roster is short), each with that player's
  best on the arena; the three arenas as cards with their real targets (A, arrows); GAME:
  HIGH SCORE / COUNTDOWN (G); ROUNDS 3 / 5 / 7 or START ON 100 / 200 / 300 (R); the rules of
  the pick in two lines; the nearest ball of the night; START (Enter); ESC back.
- **In play**: a header along the top (MENU; the arena, the game, the round and the wind; a
  chip per player with mark, number, name and score; the thrower's chip is wider, in full
  colour, with the turn's balls as pips, NEXT ×2 / ×3, CHECK OUT: <RING>, and in a
  countdown someone is out of, N BALLS TO ANSWER). It replaces the shell's header and the
  solo strip; the arcade's grade banner and the app's carry toast step aside and the
  arcade's callout (DANCE FLOOR!) rides on the ball's score instead. A small board on the
  left (B opens it big). "<NAME>, YOU'RE UP" when the thrower changes.
- **The board** (B, and by itself at the end of a round): the target drawn from the real
  ring radii with every ball as a dart in its thrower's colour and mark, where it finished
  (tee at the bottom); a ball outside the rings sits hollow on the rim, a lost ball is a
  cross; beside it the table (turn by turn, nearest ball, total or what is left).
- **A ball's score**: +75 · INNER RING ×3 · 21.8 FT; BULLSEYE! (gold); NO SCORE; MISS;
  BUST!; CHECK OUT!
- **Result**: who won (or GAME SHARED; alone: the score), how, the board, the table with
  NEW BEST and bullseyes, the nearest ball of the night, PLAY AGAIN / CHANGE GAME / EXIT.
- **Menu** (Esc or M; MENU in the header): RESUME, UNDO LAST BALL, RESTART GAME, EXIT TO
  MAIN MENU (the last two ask once). Swings still count while it is open.
- Colour is never the only cue: every chip, row and dart carries the player's mark
  (● ◆ ▲ ■) or number (`shell-core.js` `PLAYER_COLORS` / `PLAYER_MARKS`).

### Routes and events

`GET /api/bullseye` answers `{ ok, bullseye: state | null, arenas: [{ id, name, lengthYd,
theme, timeOfDay, blurb, wind, rings: [{ r, value, name }] }], bests: { <arenaId>: { high,
countdown } }, nearest, nearestEver, defaults }`. All POSTs answer `{ ok: true, bullseye }`
or `{ ok: false, error }` (400 / 404 / 409).

| Route | Body | |
| --- | --- | --- |
| `POST /api/bullseye/start` | `{ playerIds: [1 to 4 roster ids], arena: id \| 'random', variant: 'high' \| 'countdown', rounds?, balls?, target? }` | takes the bay (a match, a solo run or another mode is dropped). No ids and an empty roster: a guest plays. `random` never gives the same arena twice running |
| `POST /api/bullseye/next` | `{}` | the ball of whoever is up goes on the tee (nothing to tee up: nothing happens, still `ok`) |
| `POST /api/bullseye/undo` | `{}` | take the last ball back, and the records it made; also from the result. 409 with none. Answers `undone` |
| `POST /api/bullseye/restart` | `{}` | the same game from the top (in play or finished) |
| `POST /api/bullseye/again` | `{}` | a finished game's players, arena and options, a new game (409 while one is in play) |
| `POST /api/bullseye/abort` | `{}` | end it; also dismisses a finished one. Answers `bullseye: null` |

**SSE `bullseye`**: the state, or `null`; on connect and after every change. On a ball the
order is `shot`, `arcade`, `bullseye`, `state`; the shot carries `result.bullseye = { event:
'ball' | 'game-over', playerId, dart, total, remaining, nextPlayerId, ball, mult, turnOver,
turnScore, checkout, stray, nearest, ... }`. While a game has the bay `/api/drop`,
`/api/mulligan` and `/api/next-hole` answer 409; starting a match, a solo run or a practice
game, loading a course and `/api/reset` drop it. `BIRDIE_BULLSEYE_TEE_MS` (15000) and
`BIRDIE_BULLSEYE_DONE_MS` (600000) are the safety timeouts (0: wait for ever).

### State

```js
{
  id, seq,                                    // seq rises with every change
  variant: 'high' | 'countdown', variantLabel,
  options: { variant, rounds, balls, target },   // target: null in a high-score game
  phase: 'loading' | 'play' | 'done',
  arena: { id, name, lengthYd, theme, timeOfDay, blurb, wind },   // wind: the rolled wind (lib/arcade-wind.js), once loaded
  rings: [{ r, value, name }],                // metres from the pin, smallest first; [] while loading
  round, rounds, ball, balls,                 // the round and the ball of the turn being thrown
  currentPlayerId, order,                     // order: this round's throwing order
  teed,                                       // false: the last ball still lies where it finished
  turn: null | { playerId, score, streak, mult, start },   // mult: what the next ball is multiplied by
  players: [{
    id, name, initials, slot,                 // slot 1 to 4: the colour and the mark
    total, remaining,                         // remaining: countdown only (else null)
    turns: [{ round, score, bust, out? }],
    darts: [{ n, playerId, round, ball, x, y, // metres from the pin: x across (+ right), y along the line of play (+ long)
              ft, ring, value, name, zone: 'ring' | 'off' | 'miss', mult, score,
              miss: null | 'water' | 'ob', holed, bust, checkout?, voided? }],   // voided: points a bust took back
    bulls, misses, busts, closestFt, bestTurn, balls,
    out,                                      // countdown: checked out with this many balls (null: not out)
    finish: ['OUTER RING'],                   // countdown, whoever is throwing: the ring that checks out now
  }],
  lastBall,                                   // the newest dart
  chase: null | { playerId, balls },          // countdown: the check out to beat while its round is played out
  standings: [{ playerId, rank, total, remaining, closestFt, out }],
  winnerIds, reason,                          // 'score' | 'finish' | 'cap'; more than one winner: shared
  records: null | { bests: { <playerId>: record }, nearest, nearestEver,
                    newBest: [playerId], newNearest: null | { playerId, ft, n, ever, first } },
  undoable: null | { playerId, stray, n }, canRestart,
  events: [{ seq, type, t, ... }],            // the last 12: game-start, stage-loaded, turn, ball, checkout, turn-over,
                                              // round-over, game-over, stray-shot, ball-undone, restarted
  waiting: null | { for: 'stage' | 'tee' | 'dismiss', since, timeoutMs },
  log, startedAt, endedAt, aborted, error,
}
```

### Sound

Existing ids only, every call guarded: `lobby-open`, `select-player`, `select-stage`,
`toggle-on`, `start-match`, `ui-tick`, `ui-confirm`, `ui-back`, `ui-error`, `turn-chime`,
`trophy-tick` (a scoring ball), `streak-up` (×2, ×3), `streak-break`, `coin-burst` (a
bullseye), `sting-fail` (a bust), `whoosh` (the end-of-round board), `fanfare-win`,
`confetti-pop`; voice `m-youre-up`, `dart` (a bullseye), `m-closest-to-the-pin`,
`m-new-record`, `m-champion`. The arcade's own callouts and gallery play as always.

The mode's own ids, recorded for the second release and called by the screen in place of the
borrowed ones above (`docs/arcade-voice.md`, "Bullseye, the duel, replays"; only
`be-perfect-turn` still has no caller):

| Kind | Id | For |
| --- | --- | --- |
| cue | `be-thunk` | a dart landing on the board (every scoring ball) |
| cue | `be-bull` | the bullseye sting |
| cue | `be-bust` | a bust (a short falling slide) |
| cue | `be-checkout` | a check out |
| voice | `be-bullseye` | "BULLSEYE!" |
| voice | `be-double`, `be-treble` | the multiplier landing |
| voice | `be-perfect-turn` | three bullseyes in a turn (300) |
| voice | `be-bust` | "BUST!" |
| voice | `be-check-out` | "CHECK OUT!" |
| voice | `be-can-anyone-answer` | a check out with turns still to come |
| voice | `be-nearest-the-pin` | "nearest the pin tonight" |
| voice | `be-round-2` ... `be-final-round` | the round as it starts |
| voice | `m-player-3`, `m-player-4`, `m-player-3-wins`, `m-player-4-wins` | slots 3 and 4 (the match has 1 and 2 only) |

### Running it for real

```
node tools/arcade-holes/build.mjs --out .scratch/modes/data-b
node tools/arcade-dev/bullseye-e2e.mjs      # its own server on 18368 / 19998, stopped afterwards
```

### Notes and limits

- One game at a time, in server memory: a restart drops it (the bests are on disk).
- The lobby offers three balls a turn; the engine takes 1 to 6 (`balls`) and 1 to 20 rounds.
- A countdown's high score is the fewest balls to check out, per target; a game that ends
  at the cap sets none.
- The arcade's streak, coins and XP are the bay's, as in every mode.

## Trick shot duel

Call your shot, match it or take a letter: two players, one stage, every ball from its tee.
The challenger hits any shot; the game reads what made it special and says so as the CALL;
the other player gets one ball to match it. Main menu: TRICK SHOT DUEL.

| File | What |
| --- | --- |
| `lib/duel.js` | `createDuel`: the rules as a pure, serializable state machine (no I/O, no timers), and the pure pieces it is made of: `shotFeatures`, `curveOf`, `gadgetList`, `makeCall`, `judge` |
| `lib/duel-mode.js` | the server side: its driver (the stage into the bay, the tee and dismiss timeouts) and its routes; registered with `server.js`'s mode registry (`registerMode('./lib/duel-mode')`) |
| `public/arcade/duel.js`, `duel.css` | the screens (`DuelUI`, classes prefixed `dl-`); a mode module of the shell (`mount(ctx)`) |
| `test/duel.test.js` | 20 tests: reading a shot, the call, the judge, the game |
| `test/duel-server.test.mjs` | a whole duel on a real server over HTTP (in-process, throwaway data dir) |
| `test/duel-ui.test.mjs` | 4 tests of the page's pure parts |
| `tools/arcade-dev/duel-e2e.mjs` | whole duels over HTTP on the built stages, 120 checks |

### Rules

- **A round.** The CHALLENGER hits any shot from the tee. The game reads it and makes the
  CALL: its carry, and the one or two things most that shot's own. The other player gets
  one ball to MATCH it: every part of the call within its tolerance, and the ball in play.
  Matched: nothing happens. Not matched: a **letter**. Then **the roles swap, whatever
  happened**: the players take turns to call (a match does not keep the call; nobody sits
  out two swings running).
- **What a shot is read as** (`shotFeatures`, from the game's own result):
  - **carry** (yd): `sim.carryYd`;
  - **bend** (yd, left or right): how far the landing point is from the line the ball
    started on, read from the path (the start line is the first 12 % of the carry, 8 to
    30 m). So it is whatever bent the ball: spin, the hole's wind, a Gust. The same wind
    blows for both players for the whole duel;
  - **finish**: feet from the pin where it stopped, and the surface;
  - **apex** (ft);
  - **gadgets**: what `result.gadgets` carries, read defensively (`gadgetList`: absent, an
    array of ids, an array of objects with `id` and `kind` or `type`, `{ hits: [...] }`;
    anything else is "none" and nothing throws). Zones and a warp's exit are left out.
- **The call** (`makeCall`). The carry always leads it. Then up to two more, the ones
  furthest out of the ordinary:

  | Part | Called when | The challenger's line | To match it |
  | --- | --- | --- | --- |
  | carry | always | 150 YD CARRY | within 10 %, at least 8 yd either way (CARRY 135 TO 165 YD) |
  | gadget | the ball met one (a ring before a cannon, a warp, a wall, a pad, a strip, coins) | THROUGH THE RING | the same one |
  | finish | it stopped inside 60 ft | 12 FT FROM THE PIN | inside twice that, and at least 20 ft more (FINISH INSIDE 32 FT) |
  | green | on the green but not inside 60 ft | ON THE GREEN | on the green |
  | bend | 6 yd or more | BENT LEFT 15 YD | the same side, 40 % of it, 3 yd at the least (BEND IT LEFT 6 YD OR MORE) |
  | apex, tall | 100 ft or more | 120 FT HIGH | 85 % of it (FLY IT 102 FT HIGH OR MORE) |
  | apex, low | 30 ft or less with 100 yd of carry | A STINGER: 22 FT HIGH | no more than 125 % + 5 ft (KEEP IT UNDER 33 FT HIGH) |

  On screen: "MATCH IT: 150 YD CARRY · INSIDE 32 FT · BENDS LEFT". A plain shot's call is
  its carry alone, which is easy to match: a challenger who wants letters has to hit
  something worth calling first.
- **NO CALL.** A challenger's ball in the water or out of bounds, a duff (under 40 yd of
  carry) or a putt sets no challenge: no letter for anyone, the round is over and the roles
  swap.
- **Letters** spell a word: CLASH by default, PIG or HORSE in the lobby (the engine takes
  any word of 2 to 8 letters). **First to spell it has lost.**
- **The cap**: four rounds for every letter of the word (PIG 12, CLASH and HORSE 20), a NO
  CALL counting as a round. When they run out the player with fewer letters wins; level:
  the duel is shared.
- **Who calls first**: a toss (or `first`). PLAY AGAIN: the loser. RESTART: the other
  player.
- **Stray balls, undo, restart.** A ball under 40 mph off the tee still counts (a duff is
  NO CALL for a challenger, a letter for a matcher) but is marked: STRAY BALL? UNDO / COUNT
  IT, eight seconds. Undo takes the last shot back exactly (one level; a call, an answer,
  the one that ended the duel). No power-up balls, no rescue drop.
- **Nobody waits.** After a ball is read it stays where it finished so the picture can stay
  on it; the page asks for the next ball to be teed up once the call (3.6 s) or the verdict
  (3.2 s) has had its moment, and a swing that arrives sooner is played all the same. Swings
  are ignored only while the stage loads and on the result screen.

### The screens (`public/arcade/duel.js`)

- **Lobby**: two slots in the two player colours (keys 1 and 2 change the player; two
  players are made on the spot when the roster is short), the stage (← →: RANDOM, a par 3
  up to 240 yd or an arena, then every stage and arena), the word (W), the rules in three
  lines, START (Enter), ESC back.
- **In play**: a header (MENU; the stage, the word, the round and the wind; each player with
  their name, what they are doing (CALL YOUR SHOT / MATCH IT / CALLED IT / WAITS) and the
  word as tiles, the letters they have lit red; ROUND n and the role in the middle). While a
  call is being answered it stays on screen as a gold strip under the header: CARRY 123 TO
  150 YD + BEND IT LEFT 5 YD OR MORE + FINISH INSIDE 66 FT. "<NAME>, CALL YOUR SHOT" /
  "<NAME>, MATCH IT" when the turn changes.
- **The CALL card** after the challenger's ball: MATCH IT, and each part as a big chip, what
  the challenger did over what a match has to do.
- **The verdict** after the answer: MATCHED! (green) or LETTER: C (red), every part of the
  call with a tick or a cross and what this ball did, and the word's tiles with the new
  letter stamped in. NO CALL for a lost ball or a duff.
- **Result**: who won and how (SAM SPELLED PIG; at the cap, who has more letters; DUEL
  SHARED), both players' tiles and numbers, the last five rounds, PLAY AGAIN / CHANGE GAME
  / EXIT.
- **Menu** (Esc or M; MENU in the header): RESUME, UNDO LAST SHOT, RESTART, EXIT TO MAIN
  MENU (the last two ask once). Swings still count while it is open.
- The arcade's grade banner, the solo strip, the ball dock and the app's toast step aside
  in play; the arcade's callout rides on the card. The instant-replay chip waits while a
  card, a full-bleed screen or the menu is up.

### Routes and events

`GET /api/duel` answers `{ ok, duel: state | null, stages: [{ id, name, par, lengthYd,
theme, timeOfDay, arena, order }], words, tolerances }`. All POSTs answer `{ ok: true, duel }`
or `{ ok: false, error }` (400 / 404 / 409).

| Route | Body | |
| --- | --- | --- |
| `POST /api/duel/start` | `{ playerIds: [a, b], stage?: id \| 'random', word?: 'CLASH', first?: 0 \| 1, maxRounds? }` | takes the bay (a match, a solo run or another mode is dropped). `random` (the default): a par 3 up to 240 yd or an arena, never the one just played |
| `POST /api/duel/next` | `{}` | the ball of whoever is up goes on the tee (nothing to tee up: still `ok`) |
| `POST /api/duel/undo` | `{}` | take the last shot back; also from the result. 409 with none. Answers `undone` |
| `POST /api/duel/restart` | `{}` | the same duel from the top, the other player calling first |
| `POST /api/duel/again` | `{}` | a finished duel's players, stage and word, a new duel, the loser calling first (409 while one is in play) |
| `POST /api/duel/abort` | `{}` | end it; also dismisses a finished one. Answers `duel: null` |

**SSE `duel`**: the state, or `null`; on connect and after every change. On a ball the order
is `shot`, `arcade`, `duel`, `state`; the shot carries `result.duel = { event: 'call' |
'no-call' | 'matched' | 'letter' | 'duel-over', playerId, shot (its features), call | checks,
letter, letters, reason, nextPlayerId, role, round, stray }`. While a duel has the bay
`/api/drop`, `/api/mulligan` and `/api/next-hole` answer 409. `BIRDIE_DUEL_TEE_MS` (15000)
and `BIRDIE_DUEL_DONE_MS` (600000) are the safety timeouts (0: wait for ever).

### State

```js
{
  id, seq,
  phase: 'loading' | 'play' | 'done',
  word, options: { word, maxRounds },
  stage: { id, name, par, lengthYd, theme, timeOfDay, kind: 'stage' | 'arena', wind },
  round, maxRounds,
  role: 'challenge' | 'match' | null,           // what the swing that is awaited is
  currentPlayerId, challengerId, teed,          // teed false: the last ball still lies where it finished
  call: null | { playerId, round, text,         // the call being answered
                 parts: [{ id: 'carry' | 'curve' | 'finish' | 'green' | 'apex' | 'gadget',
                           label, short, target, ...the numbers the judge reads }],
                 shot },                        // the challenger's shot, as features
  players: [{ id, name, initials, slot, letters: 'CL', lettersCount, lettersLeft,
              calls, noCalls, matched, missed, shots }],
  last: null | { kind: 'call' | 'no-call' | 'matched' | 'letter', playerId, round,
                 shot: { clean, miss, isPutt, carryYd, curveYd, apexFt, finishFt, lie, holed, speedMph, gadgets: [{ id, kind }] },
                 text, parts,                   // a call
                 checks: [{ id, ok, want, got }], call, letter, letters,   // an answer
                 reason: 'hazard' | 'duff' },   // no call
  history: [{ round, challengerId, call, matcherId, result: 'matched' | 'letter' | 'no-call', letter, reason }],
  winnerId, loserId, reason,                    // 'word' | 'cap'; both null at the cap: shared
  undoable: null | { playerId, stray, role }, canRestart,
  events: [{ seq, type, t, ... }],              // the last 12: duel-start, stage-loaded, turn, call, no-call, matched,
                                                // letter, duel-over, stray-shot, shot-undone, restarted
  waiting: null | { for: 'stage' | 'tee' | 'dismiss', since, timeoutMs },
  log, startedAt, endedAt, aborted, error,
}
```

### Sound

Existing ids only, every call guarded: `lobby-open`, `select-player`, `select-stage`,
`toggle-on`, `start-match`, `ui-tick`, `ui-confirm`, `ui-back`, `ui-error`, `turn-chime`,
`stage-sting` (the call), `fanfare-hole` and `confetti-pop` (matched), `sting-fail` (a
letter), `whoosh`, `fanfare-win`; voice `m-get-ready` (your call), `m-youre-up` (match it),
`m-player-1-wins`, `m-player-2-wins`, `m-all-square`. The arcade's own callouts and gallery
play as always.

The mode's own ids, recorded for the second release and called by the screen in place of the
borrowed ones above (`docs/arcade-voice.md`, "Bullseye, the duel, replays"):

| Kind | Id | For |
| --- | --- | --- |
| cue | `dl-call` | the call card slamming in |
| cue | `dl-letter` | a letter stamped on the tiles |
| cue | `dl-matched` | a match (short, bright) |
| cue | `dl-no-call` | no call (a deflating slide) |
| voice | `dl-call-your-shot` | "call your shot" |
| voice | `dl-match-it` | "match it!" |
| voice | `dl-matched` | "matched!" |
| voice | `dl-letter` | "that's a letter" |
| voice | `dl-no-call` | "no call" |
| voice | `dl-one-letter-left` | a player is one letter from the word |
| voice | `dl-spelled-it` | the word is spelled |

### Running it for real

```
node tools/arcade-holes/build.mjs --out .scratch/modes/data-b
node tools/arcade-dev/duel-e2e.mjs      # its own server on 18368 / 19998, stopped afterwards
```

### Notes and limits

- One duel at a time, in server memory: a restart drops it. Nothing is kept on disk (no
  record, no profile change: a duel is a friendly).
- The bend is read from the path, so on a windy stage a straight ball bends and is called
  as bending; the matcher's ball rides the same wind.
- A call names at most one gadget (the highest-ranking one the ball met).
- The arcade's streak, coins and XP are the bay's, as in every mode.

## Instant replay and highlights

A notable shot is shown again from a camera that is not the one that filmed it live, and the
best shots are kept on a reel that the main menu's HIGHLIGHTS entry plays back. Nothing here
ever delays a player who is ready: a real swing during a replay ends it at once and is played.

| File | What |
| --- | --- |
| `lib/highlights.js` | pure: what makes a shot notable, how it is ranked, the reel (the last game in memory, the night's best through an injected read / write), the shot of the match |
| `lib/highlights-mode.js` | the server's side: a mode of the registry that never owns a swing; listens to every shot (`onShot`), keeps `<dataDir>/highlights.json`, the routes |
| `public/arcade/replay-core.js` | pure: the three replay cameras, which one films a shot, the replay's own clock (no DOM; unit tested) |
| `public/arcade/replay.js` | `ReplayDirector`: plays a replay on the scene, the REPLAY tag, skip and cancel |
| `public/arcade/highlights.js` | the HIGHLIGHTS screen (a mode module of the shell: `mount(ctx)`) |
| `public/arcade/replay.css` | the tag (`rp-`), the offer chip, the SHOT OF THE MATCH button, the HIGHLIGHTS screen (`hl-`) |
| `public/app.js` (marked `v3:modes`) | WHEN a replay plays, and how the picture and the held state are put back |
| `public/render/scene.js`, `flight-camera.js` (marked `v3:modes`) | three small additive hooks (below) |
| `test/highlights.test.js` (8), `test/highlights-server.test.mjs` (1), `test/replay-camera.test.mjs` (9) | the reel, the routes on a real server, the cameras filmed frame by frame |
| `tools/arcade-dev/highlights-e2e.mjs` | two real matches on the built tour over HTTP, a restart, 41 checks |

### Which shots

`notable(result, about)` in `lib/highlights.js`, decided on the server as the shot is played
and written on the shot itself: `result.highlight = { id, why: [...], title, auto }`.

| `why` | A shot is notable when | Title |
| --- | --- | --- |
| `ace`, `hole-out` | the ball really drops (the path has a `holed` event) from off the green | HOLE IN ONE · HOLED FROM 95 YD · CHIP-IN |
| `long-putt` | a putt from 15 ft or more drops | 27 FT PUTT |
| `epic` | the arcade grade gave an EPIC callout about the shot (PIN SEEKER!, ABSOLUTE BOMB!, PERFECT SHOT!). A streak's own shout (ON FIRE, UNSTOPPABLE) does not count | the callout |
| `match-winner` | the shot ends a match and its shooter won it (`result.match.event === 'match-over'`, `winnerId === playerId`) | THE MATCH WINNER |
| `hole-winner` | the shot wins its shooter a hole by dropping, and is not a putt of under 8 ft | FOR THE HOLE |
| `sudden-death` | the ball that wins a sudden death | SUDDEN DEATH WINNER |
| `clutch` | a ball that was FOR THE WIN or TO TIE and dropped (`result.match.clutch`), whatever its length | CLUTCH |

Never notable: a conceded tap-in (holed in the book, but nothing dropped), a shot that lost its
own shooter the hole, a concession, a rescue drop, a practice game's ball. The deciding rules
read `result.match.event` (`hole-won`, `hole-tied`, `match-over`) and `winnerId` only: they
do not assume two players. `score` ranks them: the arcade points of the shot plus 5,000 for an
ace, 2,500 (+5 a yard) for a hole-out, 600 (+10 a foot) for a long putt, 800 for an epic
callout, 1,500 for a match winner, 700 for a sudden death, 500 for a hole winner, 400 for clutch.

`auto` is true in a match (versus and party): the replay plays by itself, once. Anywhere else
(solo, free play, a mode's game) it is false: the replay is only offered.

### When a replay plays (`public/app.js`)

- **In a match: by itself, once.** The ball stops; its callout banner has the screen for a
  beat (1.7 s, 2.6 s for an epic one); the picture cuts to the replay; when it is over the
  shot ends exactly as it always did (the hole's result screen, the winner screen, or the
  next player's ball). The game's state is held back through the beat and the replay the way
  it is held while a ball is in the air (`animating` stays true: `state` and `match` events
  wait), and the 2 s "result keeps the screen" hold is not added on top.
- **In solo play: offered.** A chip, `P ▶ REPLAY <title>`, for nine seconds; **P** or a click
  plays it. Nothing waits for it.
- **Skip**: any key, a click, or a swing. A swing the server ignores (a result screen is up,
  the menus are) is reported to the page as `swing-ignored { by, phase }` (or `shell-swing`),
  which skips a replay, or the beat before one. The key or click that skips does nothing else.
- **A live ball cancels**: the `shot` handler's first act is `cancelInstantReplay()`. The
  replay lets go at once; what the replayed shot's own ending would have done is done on the
  spot (the held state is applied, the match header moves on), the camera is the address
  camera again, and the live shot is played like any other.
- `?replay=0` on the page's address: no replay plays by itself (tools that drive a match).

### The cameras (`public/arcade/replay-core.js`)

The live camera is the ball cam: it leaves the tee behind the ball. A replay uses one of three
others. Each is one continuous move with no cut inside it, worked out once from the known
path, in the plan shape `flightCameraPlan` gives, so `scene.playShot` plays it unchanged
(`opts.cameraPlan`). The replay cuts TO its camera and cuts back.

| Camera | Tag | Chosen for | What it does |
| --- | --- | --- | --- |
| `greenside` | GREEN-SIDE CAM | every putt; any shot that is holed, lips out or finishes within 15 ft (`closeOne`) | a low tripod (0.7 m) 4.5 to 13 m beyond the cup, a little off the line, on the far side from where the ball comes. While the ball is in the air it frames the green, wide, the cup in the lower half and the sky above; the ball drops into the picture; then it follows ball and cup together. For a full shot it films the ARRIVAL only: the last 2.6 s of the flight, then everything (`arrivalSim`) |
| `topdown` | SKY CAM | a carry of 165 m (180 yd) or more | 55 to 95 m above the ground under the ball (always 30 m above the ball), looking 14 degrees off the vertical, the way of the shot up the screen, riding along while the tracer is drawn across the hole; closes in for the run-out |
| `reverse` | REVERSE ANGLE | everything else | the chase from the opposite side: it flies 9.5 m AHEAD of the ball, a little to the side the ball curves away from, looking back at it; a second before touchdown it goes on to wait 6.5 m beyond where the ball finishes (4.2 m beyond the cup for a close one) and watches it run in |

When the camera asked for cannot film the shot (no clear spot for the tripod, nothing to
trace) the next is tried: `greenside`, `reverse`, `topdown`. The HIGHLIGHTS screen can ask
for one by name (key **C**).

Built on the flight camera's own tools: the same sampling of the ball, `liftCameraPath` (the
chase cameras' clearance, exported: above the ground, the tree crowns and any ground between
camera and ball), the same leash that keeps the ball in the frame. On top of that a replay
camera keeps out of the props (`PropsLayer.obstacles()`): over one it can clear, round one
that towers over its path, and a tripod never stands in or under one, never looks through
one, and prefers a spot where none fills the picture.

**It never flips.** `reverse` stays ahead of the ball along the way it came in, with the
heading held from touchdown as the ball cam holds it (a ball knocked back by a tree does not
turn it round); `topdown` keeps one heading for the whole shot; `greenside` stands still.

**Time.** A replay plays the path as live play re-times it (`feel.js warpShot`) with one
difference: no hit-stop at impact. Slow motion only by the pin (`replaySim`).

**Sound.** One guarded cue at each cut (`replay-in`, `replay-out`: a tape whip, forwards and
backwards), and the announcer says what it is (`m-replay`, `m-shot-of-the-match`). No shot
sounds, no crowd, nothing that loops.

Tests (`test/replay-camera.test.mjs`) film all three cameras over the sixteen real shots of
`test/helpers/camera-shots.mjs` (the cliff, the butte, the Rocket drive, the lip-out ...): the
ball in the frame, the camera above the ground and with the ball in plain sight, no jump and
no swing of the view of more than 14 degrees in a frame, never the live camera's place, the
side each camera must keep, a tower gone round and a hut gone over, crowns cleared, a statue
on the tripod's spot, a wall round the green (the next camera films it), and the clock.

### The reel (`lib/highlights.js`)

- **The last game**: the notable shots of the most recent match (or solo run, or mode game),
  in memory, newest first, twelve at most. A new game starts the list over with its first
  notable shot. Lost when the server stops.
- **The night**: the best eight by score, in `<dataDir>/highlights.json` (about 12 KB a shot:
  the path is thinned to 420 samples at most, to the centimetre). A night is a run of play
  with no break of six hours or more between two shots. The first shot after such a break
  starts a new night and the old list is dropped THEN, not before: the morning after, last
  night's best is still there to watch (`night.current: false`, the screen says LAST
  SESSION'S BEST).
- **The shot of the match**: the engine's award is "most arcade points on one shot", notable
  or not. The reel keeps every player's best-paid shot of the match in play (the engine's own
  rule: more points than any before it), and when the finished match's `awards` carry
  `shot-of-the-match` it names that player's shot (`shotOfMatch { matchId, id }`), adding it
  to the last game's list when it was not notable by itself. A deciding swing that is taken
  back (`POST /api/match/undo`) takes the award back with it.

On the winner screen (`matchUI.onWinnerScreen`, which the party's winner screen calls too) the
award's row gets a **▶ REPLAY** button. It also plays once by itself seven seconds after the
screen came up, unless it is the deciding shot that was just shown, its stage is not the one
in the bay (a press loads it), or somebody has touched a key or the screen meanwhile.

#### Routes and events

| Route | Body | |
| --- | --- | --- |
| `GET /api/highlights` | | `{ ok, highlights: state }` |
| `POST /api/highlights/play` | `{ id, camera? }` | the highlight's stage is put in the bay when another course is there (409 while a match, a solo run or a mode's game is in play: `"A match is in play: finish or leave it first"`; a finished match still on its winner screen does not count), then the `replay` event goes out. Answers `{ ok, playing, loaded, highlights }`. 404: no such highlight |
| `POST /api/highlights/remove` | `{ id }` | |
| `POST /api/highlights/clear` | `{ which: 'last' \| 'night' \| 'all' }` | |

| Event | Data |
| --- | --- |
| `highlights` | the state, on connect and whenever the reel changes |
| `replay` | `{ id, at, camera, loaded, highlight }`: the whole record, path and all; the page waits for the stage's ground when `loaded`, takes the scene to that hole and spot, and films it |
| `swing-ignored` | `{ by: 'match' \| 'solo', phase }`: a swing the game dropped (server.js `playShot`) |
| on `shot` | `highlight { id, why, title, auto }` on a notable shot; `replayId` on a match shot that is only being kept in case it is the shot of the match |

```js
// state
{ seq,
  last:  { game: null | { id, kind: 'match' | 'solo' | 'mode' | 'free', label }, shots: [summary] },   // newest first
  night: { startedAt, lastAt, current, shots: [summary] },                                              // best first
  shotOfMatch: null | { matchId, id } }
// summary (no path)
{ id, at, why, title, score, points, grade, callout, player: { id, name, slot }, stage: { id, name, courseName },
  holeNumber, game, matchId, isPutt, carryYd, totalYd, fromYd, endFt, holed, strokes, powerup, shotOfMatch, replayable }
// the record a replay is given (lib/highlights.js recordOf): the summary's fields, and
{ shotId, hole: { pin, tee, ref, par }, from: { x, y }, aimDeg, lie, launch, club, end,
  stage: { id, name, file, courseName },
  sim: { points: [[t, x, y, z], ...], flightTime, isPutt, events, carryYd, totalYd, apexFt, offlineYd } }
```

### The HIGHLIGHTS screen

Main menu > HIGHLIGHTS. LAST MATCH (LAST GAME after solo play) on the left, BEST OF THE NIGHT,
ranked, on the right: what it was, who (in their slot colour and mark), where, the points.
Up / down, left / right for the other list, Enter to watch it on its own stage, **C** for the
camera (the director's choice, or one of the three), Esc back. It is a menu screen: the swing
gate is shut, a swing there is nobody's shot (it only skips a replay that is playing). An
empty reel says how to fill it.

### The hooks in the renderer (all additive, marked `v3:modes`)

- `scene.playShot(..., { cameraPlan })`: a function `(points, env) -> plan | null`; a plan
  with a `path` replaces the usual flight camera for that playback.
- `scene.stopShot()`: end the shot that is playing now (a skipped replay): no callback, the
  tracer gone, the camera the address camera again.
- `flight-camera.js`: `liftCameraPath(pos, balls, { dt, groundAt, topAt, clearM, sight })`
  (the chase cameras' clearance as a function) and the exports `leashLook`, `boxSmooth`,
  `maxSpread`, `easeInOut`. Nothing that was there is changed.

### Audio and voice ids this would like

All through guarded calls, and all recorded (`docs/arcade-voice.md`): cues `replay-in` and
`replay-out` (a short tape-style whip at the cuts), `replay-offer` (a soft pluck as the chip
appears), `lobby-open`, `ui-tick`, `ui-confirm`, `ui-back`, `ui-error` on the HIGHLIGHTS
screen; voice lines `m-replay` ("Let's see that again"), `m-shot-of-the-match` ("The shot of
the match"), `m-highlights` ("Tonight's best").

### Limits

- A shot that was taken back (undo, a stray ball) stays on the reel until it falls off or is
  removed: the reel is not told about an undo (only the shot-of-the-match award is, lazily).
- The arrival trim of the green-side camera drops a gadget's own clock (`sim.toPlayTime`), so
  a gadget effect does not fire in that replay.
- The reel's last game and the shot-of-the-match candidates live in server memory.
- With `?arcade=0` (the plain simulator's screens) there is no director and no replay.

## Looking at it

Every screen of these modes was looked at in a headless browser on a private server (no window,
no sound), in the manner of `tools/release/screenshots.mjs`: the lobbies, the in-play headers for
four players at 1600 x 900 and 1280 x 720, the Bullseye board, a replay in progress from each
camera, the result and winner screens. The stills are not kept in the repository.
