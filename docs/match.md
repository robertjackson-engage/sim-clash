# Match mode (v2)

Arcade 1v1 golf on a real launch monitor: two players, one bay, real balls, a loud 1v1. Hot-seat
(the players alternate swings at the same simulator). The contract every stream builds
against is `docs/dev/arcade-v2-contract.md` section 4; this file is how the engine does it.

| File | What |
| --- | --- |
| `lib/match.js` | `createMatch`: the rules as a pure, serializable state machine. No I/O, no timers, no course loading. Also the pure profile / reward maths. |
| `server.js` | the match's **driver** (`driveMatch`, `loadMatchStage`), the routes, the profile ledger, the escrow, `playShot` |
| `test/match.test.js` | 31 tests of the engine, `node --test test/match.test.js` |
| `tools/arcade-dev/match-e2e.mjs` | a real best of three over HTTP against a private server (some 280 checks) |
| `public/arcade/match.js`, `match.css` | `MatchUI` (stream match-ui) |
| `lib/arcade-wind.js` | the wind of each hole: the roll, the read against the hole, the bay's keeper (section "Wind") |
| `test/arcade-wind.test.js`, `test/arcade-wind-server.test.mjs`, `test/arcade-wind-ui.test.mjs` | 13 + 1 + 2 tests of the wind: the roll, a real server over HTTP, the chip |
| `tools/arcade-dev/wind-e2e.mjs` | a real best of three on the built tour, checking every hole's wind (some 85 checks) |
| `test/match-menu-server.test.mjs`, `test/match-menu-ui.test.mjs` | the match menu's routes on a real server over HTTP; the menu's items and the stake line |
| `tools/arcade-dev/menu-e2e.mjs`, `stake-e2e.mjs` | real runs on the built tour: a stray ball taken back, restart hole / match (22 checks); putt in to tie / to win (11) |

## Rules

- **Putting.** A match plays its own putting assist, `options.putting`: `'assist'` by
  default (a decent putt drops: start line within 2.5 degrees, pace from 85 % to 140 % of
  the right one; anything else is a miss that finishes close), `'easy'` (4.5 degrees, 80 %
  to 160 %) or `'off'` (the real stroke at the real cup). The bay's own setting (default
  `easy`) is for solo play. So PUTT IN TO WIN can be missed and a must-make putt can be a
  knockout: an average putter holes about 4 in 10 from 30 ft on `assist`, 7 in 10 on
  `easy` (docs/arcade.md "Putting levels"). The tap-in distance is the bay's, as before.
  The lobby's options drawer has it: PUTTING: EASY / ASSISTED / REAL.
- **Drop on the line.** The player who is up may take the rescue drop instead of swinging
  from where the ball lies (`POST /api/match/drop`, the HUD's DROP ON THE LINE, the match
  menu): back on the hole's routing line, on fairway or tee turf, no nearer the hole
  (docs/arcade.md "Dead lies and the rescue drop"). It costs a stroke, or nothing when the
  game judges the lie dead (`game.state().rescue`). The stroke counts like any other, at
  once: out with as many as the player who is in is a knockout, par + 3 is the cap, so a
  drop can lose the hole. It spends no ball or trick and is no swing in the stats. Undo
  takes it back like a swing. Not in a sudden death.
- **Formats**: `quick` (one hole), `bo3` (first to 2), `bo9` (first to 5). The match ends
  the moment it is won.
- **Stages.** Every hole of a match is a stage of the Clash Tour: its own single-hole
  course (`<dataDir>/arcade-tour.json`, written by `tools/arcade-holes/build.mjs`). The
  bay switches course between holes. `quick`: the stage asked for, or a random one. A
  series: tour order from stage 1 (or from the stage asked for), or shuffled
  (`order: 'shuffle'`); no stage twice until every stage has been played (a tour of three
  under a best of nine goes round again, never the same stage twice running). Tour order
  plays the tour proper, orders 1 to 9; stages beyond (the extreme ones, `order` 10 and up)
  come up when asked for by id (they then open a series), in a shuffle, and in the quick
  draw.
- **Rocket holes.** A stage may carry `freeBall` (a ball id, in the manifest entry and as
  `course.arcade.freeBall`). On such a stage every player's FIRST stroke of the hole is
  played with that ball for free: no charge, not added to `usedPowerups`, and a ball the
  player armed themselves stays armed for a later shot. A trick on that player is still
  spent with the swing. It applies with `powerups: 'off'` too, on an arena to every
  sudden-death ball, and never to the same-hole shootout. A `freeBall` that is not a ball
  of the catalogue is ignored. Nothing is emitted: the UI reads `stage.freeBall`. In solo
  play `playShot` does the same for the first stroke on a course with `arcade.freeBall`
  (arcade layer on, not a league round or practice), leaving the bay's shelf and its armed
  ball alone. The shot carries `result.freeBall` (and `result.match.free` in a match).
  `stage: 'current'` plays the course that is loaded instead: holes follow the course from
  the round's hole, wrapping at the end, and the round is put back afterwards. With no
  manifest only `'current'` works (and is the default).
- **Wind.** Every hole has a wind of its own, rolled when its stage comes up: the same for
  both players for the whole hole, a new one for the next hole and for every arena. See
  "Wind" below.
- **Honour.** A coin flip on hole one (`coin-flip` event). After that the winner of the
  previous hole (a halved hole leaves it where it was). Both tee off, honour first; then
  whoever is **farther from the hole** plays (level: fewer strokes, then the honour). A
  player who is in, or out of strokes, waits.
- **On the green the score decides.** When BOTH balls are on the green (and neither is in)
  the player with **fewer strokes** putts first, whoever is farther; level on strokes:
  farther from the hole first, as anywhere. What that does with the knockout rule: the
  leader lies N-1 and the other has taken at least N, so the leader's putt is always **for
  the win**: a make is N against N or more, a knockout on the spot, and the other never
  gets a swing. If the leader misses and they are now level, the farther ball goes, and
  whoever holes first leaves the other exactly one swing that must drop (`mustHole`). So on
  the green the pressure is always on the next putt: to win, or to tie. Off the green
  nothing changes.
- **What a swing is for** (`shotStake()`, on the player who is up as `shotFor` /
  `shotKind`, and on the `turn` event). `shotFor`: `'win'` holing this shot wins the hole
  at once (the opponent is in with more than it would make, or is out having already taken
  at least as many strokes as it would make, or is out of strokes); `'tie'` holing it ties
  the hole (the opponent is in with exactly what it would make: the `mustHole` swing);
  `'lead'` holing it leaves the opponent one swing to tie (they are out with one stroke
  fewer than it would make); else `null`. `shotKind`: `'putt'` on the green, `'chip'` off
  it within 40 yd of the pin, else `'shot'`. Both `null` for the player who waits and in
  sudden death. With A in for 3: B lying 1 is `win`, lying 2 `tie`. Both out, lying 2 and
  2: `lead`; 2 against 3: `win`; 3 against 2: `null`. When a ball that was `win` or `tie`
  drops, the `hole-won` / `hole-tied` event (and the shot's `result.match`) carries
  `clutch: 'win' | 'tie'`, and the log line of a tie starts "<name> TIED IT UP!".
- **Stray balls.** A swing under 40 mph from a full-shot lie (anything but a green) more
  than 40 yd from the pin still counts, but is marked: `stray: true` on the shot
  (`result.stray`, `result.match.stray`), a `stray-shot` event, `undoable.stray`. The UI
  asks "STRAY BALL?" for eight seconds; UNDO takes it back, no answer means it counts.
  Putts and chips are never marked (`isStrayShot()`; the monitor's own ball speed).
- **Undo, restart** (the match menu). `undoLastShot()` puts the match back exactly as it
  was before the last swing: positions, strokes, lies, the ball and the trick that rode on
  it, charges, stats, a sudden-death result, and the hole or the match if that swing
  decided it (from `'hole-result'` or `'done'` back into `'play'` / `'tiebreak'`). One
  level; anything armed or cast since goes back with it; not once the result screen has
  been left (`continue`), not after a concession. `restartHole()` (in `'play'` /
  `'tiebreak'`) puts the hole back as it teed off: both on the tee, no strokes, the balls
  and tricks spent on it back in the loadouts, its stats forgotten, the same wind and
  honour; in a sudden death it is the round being played. The events and the log are
  history and stay; `seq` and the wait token only ever rise.
- **Knockout.** The hole ends the moment it is decided. A is in with N strokes:
  - B is out and has taken N (or more): B has lost, no swing (`reason: 'knockout'`);
  - B is out with N-1: exactly one swing, `mustHole: true` on B and a `must-hole` event.
    Holed: tied. Missed: knockout. (A conceded tap-in is a stroke, so "inside the gimme"
    after that swing is N+1 against N: both in, `reason: 'score'`.)
- **Stroke cap**: par + 3 (`options.strokeCap`). A player who reaches it without holing out
  is `capped` and stops; penalty strokes count. The other plays on: holing out wins the
  hole (`reason: 'cap'`); also capped: the hole is tied.
- **Tied hole.** `tieRule: 'shootout'` (default): settled at once by SUDDEN DEATH, closest
  to the pin, one ball each on a tiebreak arena (random; none twice until all have been
  used). Nearest wins the hole. Water or out of bounds is a **miss** and loses to any ball
  on land. Both miss, or the balls finish within 0.1 ft: another round, the other player
  first. The honour of the tied hole leads off round one. A ball inside the tap-in circle
  keeps its real distance; only a ball that drops is 0.
  `tieRule: 'halve'`: the hole is halved (`reason: 'halved'`) and only a match that is level
  when the holes run out goes to sudden death (a playoff, one more `holeResults` entry with
  `playoff: true`).
  No arena (a tour without tiebreaks, an arena that will not load, or `stage: 'current'`):
  the sudden death is played on the hole just played, from 150 yd back along its line (the
  tee if the hole is shorter). Stage `id: 'shootout'`, `tiebreak.arenaId: null`.
- **Hazards** (`hazardLosesHole`, off by default): on, a ball in the water or out of bounds
  loses the hole on the spot (`reason: 'hazard'`). Off: the game's +1 and a drop.
- **Power-ups** (`powerups`):
  - `'loadout'` (default): charges for the match (quick 2, bo3 3, bo9 6), any ball or trick
    in the catalogue, **each id once per match**. Arming a ball is free until the swing
    (swap it, put it back); the swing spends the charge and the id. A **trick**
    (`kind: 'trick'`) is cast at once: it costs its charge then and sits on the OPPONENT as
    `cursedWith` until their next swing, whenever that is (one curse on a player at a time).
  - `'unlimited'`: no charges (`charges: null`), no once-per-match. `'off'`: none.
  The catalogue is `require('./arcade').POWERUPS` (a missing `kind` is a ball; the first
  seven balls if the export is missing). A match shot never touches the bay's own shelf.
- **Concede**: either player, in any phase. No mulligans, no next-hole. A match cannot
  start during a league round.
- **Stakes** are off by default (`stakes: null`, a friendly). `stakes: 'rookie' | 'amateur'
  | 'pro' | 'master'` (entry 50 / 200 / 1,000 / 5,000 coins from each player's profile)
  puts both fees into the pot, held in escrow on disk while the match is in play; the
  winner takes it, an aborted match refunds it, a crash refunds it on the next start.

### Profiles and rewards

Each roster player has a profile `{ trophies, rank, wins, losses, streak, bestStreak, coins }`
in `<dataDir>/match-ledger.json` (the first ledger's `{ coins, trophies, streak, wins,
losses }` records are read into profiles as they are). Rank from trophies: Rookie 0,
Amateur 100, Pro 300, Expert 600, Master 1000, Legend 1500. A new profile starts with
1,000 coins.

| A win pays | quick | bo3 | bo9 |
| --- | --- | --- | --- |
| trophies (friendly) | +10 | +20 | +40 |
| the loser drops (never below 0) | 5 | 10 | 20 |
| coins | 100 | 250 | 600 |
| chest: random balls (never a trick), by rarity | 2 | 2 | 4 |

Plus the streak bonus: +5 trophies per win in a row coming in, up to +15. With stakes the
tier's trophies move both ways instead (20 / 25 / 30 / 35) and the pot comes on top of the
coins. A concession pays the same. The winner's profile gets `rewards.winner.coins`; the
chest goes onto the **bay's** shelf (`arcade.grantBalls`) and the format's coins into the
bay's wallet too (`arcade.addCoins`), so the HUD's counters move.

`rewardsFor()`, `applyRewards()`, `normalizeProfile()` and `rankFor()` in `lib/match.js`
are pure; `server.js` keeps the ledger.

## The engine and its driver

`lib/match.js` knows the rules and nothing about files, HTTP or time. Whatever it needs
from the outside world it asks for through **`match.waiting`**, and a driver does it:

| `match.waiting` | The driver |
| --- | --- |
| `{ for: 'stage', file, stageId, kind, token }` | puts that course in the bay, then `match.stageReady(game, token)`; a load that fails: `match.stageFailed(token, message)`. `file: null`: the loaded course is the one (stage `'current'`, the same-hole shootout): `stageReady` at once. |
| `{ for: 'ready', timeoutMs, token }` | the intro is showing: `match.ready(game)` on `POST /api/match/ready`, or when the safety timeout runs out (25 s) |
| `{ for: 'continue', timeoutMs, token }` | the hole result is showing: `match.continue()` on `POST /api/match/continue`, or after the safety timeout (60 s) |
| `{ for: 'dismiss', timeoutMs, token }` | the match is over: the driver drops it after the timeout (10 min) unless `abort` / `rematch` came first |
| `null` | a swing is awaited (`'play'`, `'tiebreak'`) |

`token` changes with every request, so an answer to an old one (a course that arrives after
the match was conceded) is ignored. The timeouts are numbers the match was created with
(`createMatch({ timeouts: { readyMs, continueMs, doneMs } })`); the engine never sets a
timer, so its tests never wait. The server reads them from `BIRDIE_MATCH_READY_MS`,
`BIRDIE_MATCH_CONTINUE_MS`, `BIRDIE_MATCH_DONE_MS` (0: wait for ever).

In `server.js`:

- `driveMatch()` looks at `match.waiting` after every change and sees to each request once:
  `loadMatchStage()` for a course, a `setTimeout` for a screen.
- `loadMatchStage()` is `activationManager.activate({ cached: file })`, the path
  `/api/load-course` takes (so clients get the usual `course` event and refetch the
  geometry). The hole's wind is rolled as the course is committed (`rollStageWind()`, with
  the match's `progress`); it is handed to `stageReady(game, token, { wind })`.
- `matchChanged()` = `driveMatch()` + broadcast `match` and `state`.
- `dropMatch()` ends whatever match there is, refunds held stakes and hands the bay back
  (`match.abort(game)`): a tour match leaves the bay on its last stage with a fresh hole
  (`game.reset()`), a `'current'` match puts the round back exactly as it stood. Safe when
  there is no match.

### Wind

Every hole has its own wind, rolled fresh each time it is played. `lib/arcade-wind.js`:

- **The range.** `course.arcade.wind { min, max }` (mph) when the stage has one, else what
  its `course.arcade.conditions` stand for: `calm` 0 to 5, `breezy` 6 to 12, `windy` 12 to
  22; nothing: calm (`windRange()`; whole mph, 0 to 40, whatever the file says).
- **The roll.** `rollWind({ arcade, hole, progress, random })`: a whole speed inside the
  range and a direction anywhere round the compass (two draws of `random`: the speed, then
  the direction). `progress` is 0 to 1 through a series (`match.progress`: holes played /
  (holes of the format - 1); a quick match: 0): at 0 every speed of the range is as likely
  as any other, at 1 the speed is as if the best of three draws were taken, so late holes
  lean toward the top of the range. `BIRDIE_WIND_SEED=<n>` makes the server's rolls
  repeatable.
- **The read.** `describeWind(mph, dirDeg, hole)` reads a wind against the hole's tee-to-pin
  line. A wind, as `stage.wind` carries it:

  ```js
  { mph: 12,                 // whole mph
    dirDeg: 225,             // compass bearing it blows FROM (the game's windFromDeg)
    relDeg: 45,              // where it blows TO relative to the direction of play: 0 straight at the
                             // pin, 90 left to right, 180 / -180 in the face, -90 right to left
    cross: 'R',              // 'R': it pushes the ball RIGHT (left to right) | 'L' | null
    along: 'tail',           // 'tail' helping | 'head' hurting | null
    crossMph: 8.5, alongMph: 8.5,   // + right, + helping
    strength: 'moderate',    // 'calm' 0 to 5 | 'moderate' 6 to 12 | 'strong' 13 and up
    label: '12 MPH · LEFT TO RIGHT · HELPING',
    min: 6, max: 12,         // the range it was rolled from (null: not a rolled wind)
    rolled: true }           // false: the day's wind as it is (a match on a real course)
  ```

  A component under 38 % of the wind (within 22.5 degrees of straight) is not called: a wind
  from dead behind is `cross: null, along: 'tail'`, label `12 MPH · HELPING`. No wind:
  `mph: 0`, label `NO WIND`.
- **Applying it** (`server.js`, marked `v2:wind`). `createStageWind({ game })` is the bay's
  keeper. `rollStageWind()` looks at the course in the bay: an **arcade stage** (a course
  whose `arcade` block names a `theme`) gets a fresh roll put on `game.conditions` (that
  wind, steady, no gusts, in standard air), and the day's own conditions are held aside; any
  other course gets the day's conditions back. It is called when a course is committed (a
  match stage, an arena, a course loaded by hand), for a match hole played on the course
  already loaded, on `POST /api/reset`, on `POST /api/next-hole` and when a match is
  dropped. So one roll per hole, on the game itself: every shot of both players, the HUD's
  wind dial, the lineup and Open Connect all have the same wind, and `GET /api/state`
  `conditions.windMph` / `windFromDeg` are `stage.wind.mph` / `dirDeg`.
- **In the match state.** `stage.wind` is the rolled wind from the moment the stage is
  loaded (`'intro'` onward, through `'hole-result'`). `nextStage.wind` (and `stage.wind`
  while the very first stage loads) is the **range only**, because the roll happens with the
  course: `{ mph: null, min, max, label: '6 TO 16 MPH', ... }` when the tour manifest entry
  has `wind` or `conditions`, else `null`. A match on the loaded course (`'current'`) on a
  real course rolls nothing: `stage.wind` is the day's wind read against that hole
  (`rolled: false`). The same-hole shootout keeps the wind of the hole it settles.
- **Putting the day back.** The day's conditions are never changed by a roll and
  `conditions.json` never holds one (a change made by hand during a rolled wind is kept as
  the day's, without the rolled wind). When a match is dropped the bay is in solo play
  again: on a course that is not an arcade stage the day's conditions are in force; a tour
  match leaves the bay on its last stage with a fresh hole, which like any arcade stage in
  solo play gets a wind of its own, and the day's conditions come back with the first
  course that is not an arcade stage. `GET /api/conditions` also answers `stageWind` (the
  wind rolled for the hole in play, or null) and `day` (the conditions held aside, or null).
- **Balls and tricks.** Nothing in the physics changed: the Windcutter (`windScale: 0`) does
  not feel the rolled wind, the Gust's 25 mph comes across the aim line on top of it for
  that one shot. A rolled 15 mph crosswind moves a 150 yd 7-iron 22 yd; into it the same
  swing carries 125 yd, with it 164 (`test/arcade-wind.test.js`).
- **On screen** (`public/arcade/match.js` `windView`, marked `v2:wind`): the stage intro and
  the sudden-death intro carry a WIND chip: a dial whose arrow points the way the wind blows
  with up the screen = toward the pin, the speed in figures, the read in words, green /
  amber / red by strength. While the course is still loading it shows the range and "ROLLING
  THE WIND"; the roll lands on it. The in-play header has a small badge (arrow and mph)
  under the stage name, in a tiebreak too.

### Phases

```
'loading'      a stage's (or arena's) course is being put in the bay; swings ignored
'intro'        loaded, the first player's ball is on the tee; waiting for ready (25 s safety); swings ignored
'play'         the hole is being played
'tiebreak'     sudden death
'hole-result'  a hole was decided or tied; waiting for continue (60 s safety); swings ignored
'done'         over; swings ignored; POST /api/match/abort or /rematch (10 min safety dismiss)
```

A tied hole under `'shootout'`: `'hole-result'` (`lastResult.reason: 'tied'`,
`nextStage.kind: 'tiebreak'`) > `'loading'` > `'intro'` > `'tiebreak'`; decided, the tied
hole's result is rewritten (`reason: 'tiebreak'`, `winnerId`, `tiebreak: { arenaId, rounds }`)
and it is `'hole-result'` again, or `'done'`. The hole that decides the match goes straight
to `'done'` (no `'hole-result'` in between).

**Ignored swings.** `match.beforeShot(game)` answers `null` outside `'play'` and
`'tiebreak'`; `playShot` then drops the swing: nothing is played, no stroke, no event, an
armed ball and a curse stay where they are, the bag records nothing.

### `lib/match.js`

```js
const { createMatch, MatchError, MATCH_TIERS, MATCH_FORMATS, RANKS, TIMEOUTS,
        rankFor, normalizeProfile, rewardsFor, applyRewards, normalizeTour, powerupCatalogue } = require('./lib/match');

const match = createMatch({
  players: [{ id, name, initials?, handicap?, profile? }, { ... }],   // slot 1, slot 2
  options: { format: 'quick' | 'bo3' | 'bo9', stage: '<id>' | 'random' | 'current', order: 'tour' | 'shuffle',
             tieRule: 'shootout' | 'halve', powerups: 'loadout' | 'unlimited' | 'off', stakes: null | tier,
             hazardLosesHole: false, holeIndex /* 'current': the hole to start on */, catalogue /* tests */ },
  tour,                 // the manifest, or null
  game,                 // needed for stage 'current' (its course and round); optional otherwise
  random: Math.random,  // the coin flip, shuffles, arenas, the chest
  now: Date.now,
  timeouts: { readyMs, continueMs, doneMs },
});
```

Throws `MatchError` (`.status` 400 / 404 / 409).

| Member | |
| --- | --- |
| `waiting` | what the driver has to do (above) |
| `stageReady(game, token, { wind })` / `stageFailed(token, message)` | the driver's answer to `for: 'stage'`. `wind`: the wind the driver rolled for the hole (without one the stage carries the wind the game is playing in). A failed arena falls back to the same-hole shootout; a failed stage is replaced by another one; none left: the match is aborted (`aborted`, `error`). |
| `ready(game)` / `continue()` | leave the intro / the result screen. `false` (and nothing happens) when that screen is not showing. |
| `beforeShot(game)` | `null`: the swing does not count. Else the player who is up is loaded into the game: `{ playerId, armed, curses, free }` (`free`: `armed` is the stage's free ball, not the player's). |
| `afterShot(game, result)` | spends the ball and the curse, records the shot (with `result.arcade` on it) for the stats, decides the hole / round / match, loads whoever is next. Returns the shot's event. |
| `arm(playerId, id \| null)` | a ball for their next shot, `null` to put it back, or a trick cast on the opponent |
| `drop(game, playerId?)` | the rescue drop for the player who is up (`playerId`, when given, must be theirs: 409 "It is X's turn"). 409 outside `'play'` ("No drops in a sudden death") or with no drop to take. Returns `{ event: 'drop', playerId, drop: true, free, penalty, strokes, from, end, lie, nextPlayerId }`, or the hole's / match's closing event with `drop: true` on it when the stroke decided it |
| `putting` (getter) | `'easy' \| 'assist' \| 'off'`: the putting assist of this match's swings |
| `undoLastShot(game)` | take the last swing (or drop) back (above). `MatchError` 409 "There is no shot to take back". Returns `{ event: 'shot-undone', playerId, stray, from }` (`drop: true` when it was a drop) |
| `restartHole(game)` | the hole (or the sudden-death round) again. 409 "No hole is being played". Returns `{ event: 'hole-restarted', holeNumber, tiebreak }` |
| `concede(playerId)` | the other player wins |
| `abort(game?)`, `release(game)` | end it with no result; hand the bay back |
| `config()` | `{ players, options }` a rematch starts from |
| `state()` | the serializable state |
| `id`, `mode` (`'tour'` \| `'current'`), `phase`, `active`, `currentPlayerId`, `winnerId`, `aborted`, `stakes`, `progress` (0 to 1 through the series, for the wind) | getters |

**How the one-ball game is shared.** `Game` has a single ball. The match keeps each
player's `{ball, strokes, lie, holed, aimOffset}` and swaps the player who is up into the
game; after every shot it loads the next one, so `game.state()` (the scene, the yardages,
Open Connect's `DistanceToTarget`) always shows the ball of whoever is up and `game.player`
is that player. An aim set between shots belongs to that player. The match's hole-outs
never reach the round's card.

`afterShot` returns `{ event, playerId, ... }`; the server puts it on the shot as
`result.match = { playerId, powerup, free, curses, event, ... }`:

| `event` | Fields |
| --- | --- |
| `shot` | `nextPlayerId`, `mustHole` |
| `hole-won` | `winnerId`, `reason`, `holeResult`, `next: 'hole' \| 'tiebreak'`, `standings` |
| `hole-tied` | `reason: 'tied' \| 'halved'`, `holeResult`, `next`, `standings` |
| `tiebreak-shot` | `ft`, `miss`, `round`, `nextPlayerId`, `again?` |
| `match-over` | `winnerId`, `loserId`, `reason`, `rewards`, `holeResult` |

## State (`GET /api/match`, SSE `match`)

`null` when there is no match. As the contract's shape; fields beyond it are marked `+`.

```js
{
  id, seq,                                   // seq rises with every change
  format, formatLabel, target, maxHoles,
  stakes: null | { tier, tierLabel, entryFee, pot },
  options: { tieRule, powerups, order, hazardLosesHole, strokeCap: 3 },
  phase, currentPlayerId,                    // intro: who will tee off; loading / hole-result / done: null
  holeNumber,                                // the hole of the match in play (a tiebreak keeps the tied hole's)
  holesPlayed, holeIndex, holeRef, par, lengthYd,        // + the hole in the bay
  stage: { id, name, par, lengthYd, theme, timeOfDay, blurb, difficulty, kind,
           freeBall, routes, wind },         // never null: while the first stage loads it is that stage.
                                             // wind: the hole's wind (section "Wind"): the roll once the stage is loaded;
                                             // before that (and on nextStage) its range only, or null.
                                             // freeBall: a ball id or null (a rocket hole). routes: [{ id, name, note }] or null.
                                             // Both from the manifest entry; once the course is in the bay, from the course
                                             // (course.arcade.freeBall, course.holes[0].routes) when it has them.
  nextStage: null | { ... },                 // set during 'hole-result' and 'loading'
  honourId,
  players: [{
    id, name, initials, slot,
    strokes, lie, holed, ball, distToPinYd,
    holesWon, holeScores,                    // per closed hole; null: did not hole out
    mustHole, capped,
    charges,                                 // null: unlimited
    usedPowerups, armedPowerup, cursedWith,
    tiebreakFt,
    stats: { shots, longestDriveYd, closestFt, bestGrade, perfects, points, callouts,
             bestShot /* + { points, grade, callout, text, holeNumber } */ },
    profile: { trophies, rank, wins, losses, streak, bestStreak, coins /* + */ },   // live from the ledger
  }],
  holeResults: [{ holeNumber, stageId, stageName, par, winnerId, reason, scores, tiebreak, playoff /* + halve playoff only */ }],
  lastResult,
  tiebreak: null | { arenaId, round, pending, results: [{ round, playerId, ft, miss, holed }], spotYd /* + */ },
  standings, matchPoint,                     // matchPoint: null in a quick match
  winnerId, loserId, reason,                 // 'holes' | 'tiebreak' | 'concede'
  rewards: null | { winner: { trophies, coins, chest, streakBonus /* + */, pot /* + */ }, loser: { trophies /* a delta, <= 0 */ } },
  awards: null | [{ id, label, playerId, value }],
  // + on each player: shotFor: 'win' | 'tie' | 'lead' | null, shotKind: 'putt' | 'chip' | 'shot' | null (whoever is up on a hole)
  undoable: null | { playerId, stray, holeNumber, drop?: true },   // + the swing POST /api/match/undo would take back
  canRestartHole: true,                      // + a hole or a sudden-death round is being played
  events: [{ seq, type, t /* + */, ... }],   // the last 12
  waiting: null | { for, since, timeoutMs }, // + what the server is waiting for
  turnStartedAt, startedAt, log, aborted, concededBy, error /* + */,
}
```

- `stats`: `longestDriveYd` is the longest tee shot on a par 4 or 5 that stayed in play;
  `closestFt` the best non-putt from 30 yd or more (a sudden-death ball counts, a holed one
  is 0); `bestGrade`, `perfects` (PERFECT and JACKPOT), `points`, `callouts` come from each
  shot's `result.arcade`.
- `awards` (once done, only those somebody earned): `longest-drive`, `closest-to-pin`,
  `shot-of-the-match` (most arcade points on one shot; also carries `points`, `holeNumber`),
  `most-perfects` (not when level).
- `matchPoint` is about the hole being played, or on the result screen the one that is next.

### Events

| `type` | Fields |
| --- | --- |
| `match-start` | `format`, `playerIds` |
| `stray-shot` | `playerId`, `speedMph`: the swing just played looks like a stray ball (it counted) |
| `shot-undone` | `playerId`, `stray`, `from` (the phase it was taken back from), `drop: true` when a drop was taken back |
| `drop` | `playerId`, `free`, `strokes` (the player's, after it) |
| `hole-restarted` | `holeNumber`, `tiebreak`, `round` |
| `coin-flip` | `winnerId` |
| `stage-loaded` | `stageId`, `kind`, `holeNumber` |
| `match-point` | `playerId` (an id or `'both'`); right after `stage-loaded` of a match hole |
| `ready` | `holeNumber` |
| `tiebreak-start` | `arenaId`, `round` |
| `turn` | `playerId`, `mustHole` |
| `must-hole` | `playerId` |
| `powerup-armed` | `playerId`, `id` |
| `trick-cast` | `playerId`, `id`, `targetId` |
| `hole-won` | `winnerId`, `reason`, `holeNumber` |
| `hole-tied` | `holeNumber`, `reason: 'tied' \| 'halved'` |
| `tiebreak-shot` | `playerId`, `ft`, `miss`, `round` |
| `tiebreak-again` | `round` |
| `match-over` | `winnerId`, `loserId`, `reason` |

Every event has its own `seq`; a client plays the ones above the highest it has seen.

## HTTP and SSE

All POSTs answer `{ ok: true, match }` or `{ ok: false, error }` (400 / 404 / 409).

| Route | Body | |
| --- | --- | --- |
| `GET /api/match` | | `{ ok, match, tour: <manifest or null>, tiers, formats, profiles: { id: profile } }` (the tour lists only stages whose course file is there) |
| `POST /api/match/start` | `{ playerIds: [a, b], format, stage?, order?, tieRule?, powerups?, stakes?, hazardLosesHole?, putting? }` | `playerIds[0]` is PLAYER ONE. Dismisses a finished match first. `putting`: `'easy' \| 'assist' \| 'off'` (default `'assist'`; in the state as `options.putting`) |
| `POST /api/match/ready` | `{}` | tee off. Not in an intro: nothing happens, still `ok`. |
| `POST /api/match/continue` | `{}` | leave the result screen. Likewise. |
| `POST /api/match/arm` | `{ playerId, id \| null }` | `playerId` defaults to whoever is up |
| `POST /api/match/concede` | `{ playerId }` | |
| `POST /api/match/abort` | `{}` | also dismisses a finished match; answers `match: null` |
| `POST /api/match/rematch` | `{}` | a finished match's players and options, a new match (409 while one is in play) |
| `POST /api/match/undo` | `{}` | take the last swing back; the game has the ball of whoever is up again. From `'done'` the payout is reversed too: both profiles as they were, the entry fees back in escrow, the chest off the bay's shelf and the match coins out of its wallet. 409 when there is nothing to take back |
| `POST /api/match/restart-hole` | `{}` | the hole (a sudden death: the round) again. 409 outside `'play'` / `'tiebreak'` |
| `POST /api/match/drop` | `{ playerId? }` | the rescue drop for whoever is up (+1, or free out of a dead lie). Broadcasts `drop` (`match: true`). 409 with none to take, out of turn, or outside `'play'`. Pays the match out when the stroke decided it; `/api/match/undo` takes it (and the payout) back |
| `POST /api/match/restart` | `{}` | the same players and options from the top, **also while a match is in play** (the old one is dropped, held stakes refunded and held again) |
| `POST /api/match/grant` | `{ coins, playerIds? }` | top up profiles (as before) |

**SSE `match`**: the state, or `null`. Sent on connect and after every change. On a match
shot the order is `shot`, `arcade`, `match`, `state` (the shot that ends the match also
sends an `arcade-state` for the chest, between `arcade` and `match`). The shot carries
`result.match`. The client holds a `match` that arrives while a ball is in the air until it
has stopped (`flushMatch` in `public/app.js`).

`POST /api/arcade/arm` while a match is in play arms for whoever is up from their match
loadout (it is forwarded to the match; the bay's shelf is not touched).

Guards on the routes that move the round under a match: `/api/mulligan` (refused while a
match exists), `/api/next-hole` (refused while one is in play), `/api/reset`,
`/api/load-course`, `/api/leagues/play`, starting a practice game (they drop the match
first).

`POST /api/match/start` while a match is in play answers 409 `"A match is in play: quit it
first"`; `abort` quits it. `turn` events carry `shotFor` and `shotKind`; `hole-won` and
`hole-tied` carry `clutch` (and `hole-tied` the `playerId` of the last swing).

## The match menu and the stake line (`public/arcade/match.js`, marked `v2:menu` / `v2:stake`)

- **MENU**: a gold tab under the in-play header, a MENU chip in the top right corner of the
  intro, sudden-death and result screens, and the Esc or M key. A panel of five big buttons
  (number keys 1 to 5; six with DROP ON THE LINE third, when the game state offers a drop
  to the player who is up: FREE DROP, one press, or +1 STROKE, which asks once): RESUME,
  UNDO LAST SHOT (UNDO THE DROP after one; greyed without `undoable`), RESTART HOLE
  (RESTART ROUND in sudden death; greyed without `canRestartHole`), RESTART MATCH, QUIT
  MATCH. The last three ask once ("QUIT MATCH? YES / NO"; Y / N). The server is not paused:
  swings still count while it is open; the result screen's own countdown waits while the
  menu or the stray prompt is up, because leaving it makes the hole final.
- **STRAY BALL?** on a `stray-shot` event: UNDO (U) or COUNT IT (C), eight seconds, gone
  with the next swing.
- **The lobby** opened while a match is in play shows "MATCH IN PLAY · RESUME / QUIT MATCH"
  in place of its foot (QUIT asks once), instead of a START that cannot start.
- **The stake.** When `shotFor` is `win` or `tie` the turn banner reads "ALEX'S UP" and,
  as big as the name, "PUTT IN TO WIN" / "CHIP IN TO WIN" / "HOLE IT TO WIN" (gold) or
  "... TO TIE" (ice blue); the same words pulse as a tag under that player's side of the
  header. A full shot (`shotKind: 'shot'`) gets the line only when it is to tie, or to win
  against a score that is already in: an ace or a fairway hole-out that would merely knock
  out a player who is still out is `shotFor: 'win'` in the state but is not shouted
  (`stakeView()`). Sound: one `heartbeat-hit`, then the name and `m-for-the-win` /
  `m-to-tie`. A ball that was for the win and dropped stamps "FOR THE WIN!" on the
  hole-won screen; one that was to tie holds the header for two seconds with "TIED IT UP!"
  on that player (the ticker has the log line) before the result.

### What the app does round a match shot (`public/app.js`, marked `v2:qa`)

- **The result keeps the screen.** When the turn passes to the other player the picture
  stays on the ball that was just hit for 2 s (3.3 s for an epic callout) before the state
  and the match are applied, so the shot's banner plays over the shot and not over the next
  player's ball. A swing that arrives meanwhile cuts in. The shot that decides a hole hands
  the match state on at once (the match UI runs its own banner and result screen) and holds
  only the picture.
- **Toasts.** A match shot raises no "Carry 157 · Total 157 yd" toast (the header, the
  last-shot panel and the banner say it), and a stage raises no "Hole 1 · ..." toast (its
  intro screen does). Under any full-bleed match screen the game's own toasts are hidden; a
  toast the match UI raises itself (an error) still shows. In play a toast sits on the
  ticker's line and the ticker waits.
- **Keys.** `U` toggles the bay's unlimited balls only outside a match (in one it is UNDO
  on the stray-ball prompt).

## Running it for real

```
node tools/arcade-holes/build.mjs --out .scratch/match-engine/data
node tools/arcade-dev/match-e2e.mjs            # its own server on 8315 / 9945, stopped afterwards
```

The script adds two players through `POST /api/players`, starts a `bo3`, answers the
screens as a client would, fires `POST /api/test-shot` swings chosen by a small bot, and
checks the state at every step: ignored swings in `loading` / `intro` / `hole-result` /
`done`, a ball armed from the loadout and a trick on the opponent, a rocket hole (its own
fixture: an extra stage of order 90 with `freeBall` and `routes`) in a match and in solo play, a knockout at N and one
at N-1 (`mustHole`), a tied hole into sudden death on a real arena with a both-miss round,
the result with rewards, profiles on disk and the chest on the bay's shelf, a rematch, the
escrow of a staked match, a `'current'` match into the same-hole shootout, and (on a second
server with sub-second timeouts) all three safety timeouts.

## Notes and limits

- One match at a time, in server memory: a restart drops it (held stakes are refunded on
  the next start; profiles are on disk).
- The arcade grade, coins and XP of each shot still go to the bay's arcade wallet, and its
  streak is the bay's (shared by both players), as in solo play.
- Arcade assists (putting, dispersion, tap-ins) apply to match shots like any other shot.
  With the arcade layer switched off a match shot is a plain ball unless a ball or a trick
  rides on it.
- A finished match stays on screen until it is dismissed (abort, rematch, a new start, or
  the 10 minute safety): swings in `'done'` are ignored so a stray ball cannot close the
  result screen.
- There is no shot clock: nothing times or hurries a player setting up over a real ball (the
  user's rule: no timers, no countdowns, no repeating sounds while a player is over the
  ball). `MatchUI` still takes `shotClock` (seconds; a silent, cosmetic ring on the badge of
  whoever is up) but its default and the app's value are 0, and it never beeps.
  `turnStartedAt` is in the state.
- Online play: the same `beforeShot` / `afterShot` pair works with a remote opponent's
  launch data; what is missing is transport and identity, not rules.
