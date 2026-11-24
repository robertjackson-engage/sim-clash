# Arcade layer (server side)

Arcade golf on a real launch monitor. Every shot is graded, gets one loud
callout ("SLICE HOUSE!"), earns points, coins and XP, builds a streak, and streaks,
level-ups, jackpots and challenges hand out power-up balls. The power-ups are overpowered
on purpose; the fairness is that the player's real swing still has to earn them, and a
shot hit with one is worth half points (a Gold ball: double).

| Piece | Where |
| --- | --- |
| Power-ups and tricks, callouts, grading, economy, challenges, assists | `lib/arcade.js` |
| Physics options the power-ups ride on | `lib/physics.js` (`simulateShot` opts) |
| Per-shot hook | `Game.shotMods` in `lib/game.js`, passed on to `PracticeSession.play` |
| Wiring, routes, SSE | `server.js` (`playShot`, `/api/arcade*`) |
| Tests | `test/arcade.test.js` |

With the layer disabled (`enabled: false`) `Game.shotMods` is `null` and a shot is
played, scored and broadcast exactly as it was before the layer existed.

The stages also carry **course gadgets** (boost rings, bounce pads, breakable walls, coin
trails, multiplier rings and more): `docs/gadgets.md`. A shot that met one has
`result.gadgets`; `gradeShot` adds their coins and points, applies a landing ring's
multiplier (`multiplier.gadget`) and lets the gadget's own callout (`GADGET_CALLOUTS`:
RING IT!, SMASHED IT!, BOING! ...) outrank everything about the swing but the pin, a
streak, a hazard and a holed ball.

The interfaces shared with the match engine, the HUD and the voice pack are fixed in
`docs/dev/arcade-v2-contract.md`; this file is how `lib/arcade.js` fills them in.

## Power-ups

`POWERUPS` is an array, in display order: fifteen balls (`kind: 'ball'`) and three tricks
(`kind: 'trick'`). `launch` runs **after** `launchFromBall` has validated the monitor's
data, which is how a Rocket legitimately exceeds the 250 mph cap. Measured on a flat
fairway in standard air with the standard drive of the tests (150 mph, 12 deg, 2600 rpm,
no curve): a plain ball carries **244.4 yd** and finishes at **265.3 yd**.

| id | rarity | Launch change | Physics options | Drive: carry / total (yd) | What it does |
| --- | --- | --- | --- | --- | --- |
| `rocket` | epic | speed x1.5 | `dragScale 0.7`, `liftScale 1.2` | 496.6 / 540.3 | Apex 383 ft, 12.9 s in the air (135 mph: ~496 total, 165 mph: ~578) |
| `sticky` | common | | `bounceScale 0.05`, `keepScale 0.1`, `rollScale 6` | 244.4 / 244.5 | Dead drop: stops within a yard of its carry |
| `magnet` | rare | | `cupRadiusScale 12`, `cupMaxSpeedScale 3` | 244.4 / 265.3 | The cup captures within 2.64 m at up to 9 m/s |
| `windcutter` | common | | `windScale 0` | 244.4 / 265.3 | The ball feels no wind, a Gust trick's included (the wind reported is still the day's) |
| `laser` | rare | HLA x0.15, spin axis x0.15 | | 244.4 / 265.3 | Dead straight from the club |
| `moonball` | common | VLA +12 deg (max 60), spin x1.3 | `liftScale 1.6` | 222.9 / 247.2 | Apex 262 ft (3x), steep landing |
| `bouncy` | common | | `bounceScale 2.2` | 244.4 / 297.2 | Keeps bouncing: +32 yd |
| `fireball` | epic | speed x1.2 | `dragScale 0.85`, `liftScale 0.8`, `bounceScale 1.2`, `keepScale 1.5`, `rollScale 0.25` | 324.4 / 429.6 | Hot and low (apex 113 ft) and a 105 yd run-out; a 7-iron runs to ~238 |
| `ghost` | rare | | `ignoreTrees` | 244.4 / 265.3 | No tree collisions at all: the flight is the one over open ground |
| `skipper` | common | | `waterSkips 5` | 244.4 / 265.3 | Skips off water up to five times: a drive covers ~93 yd of water after its carry, a 7-iron ~66 yd; reaches the far bank of a 60 yd creek |
| `yoyo` | rare | | `ripBackYd 20` | 244.4 / 224.4 | Lands, bites and rolls straight back 20 yd (driver, 7-iron and wedge alike, on fairway and green); less after a chip, nothing out of sand |
| `homing` | epic | | `homing 1` | 244.4 / 265.3 | A sideways force in flight toward the aim line: a 16 yd fade finishes 0.8 yd off, a 40 yd slice 2.1 yd (7.5 yd off at its widest), a 51 yd hook 2.8 yd |
| `titan` | rare | speed x1.25, spin axis 0 | | 323.5 / 348.2 | No curve whatever the swing: it finishes where its start line points |
| `feather` | common | | `gravityScale 0.55`, `dragScale 1.15`, `bounceScale 0.1`, `keepScale 0.15`, `rollScale 5` | 298.0 / 298.1 | 11.2 s in the air (plain: 6.2), +22 % carry, stops where it lands |
| `gold` | epic | | | 244.4 / 265.3 | A plain ball: the shot pays double points and double coins |
| `gust` | common | | `crossWindMps` +/- 11.18 | trick | A 25 mph crosswind for that shot, from a random side: a pure drive finishes ~40 yd off line, a wedge 28 yd |
| `tiny-cup` | rare | | `cupRadiusScale x0.25`, `cupMaxSpeedScale x0.45` | trick | The cup the shot would have had, a quarter the size and taking under half the pace |
| `fog` | common | | | trick | No physics: the HUD hides the yardages (`arc-fog`) |

Rocket was specified as speed x1.8 / drag 0.35 / lift 1.2; measured, that flies ~840 yd,
so it is tuned to the 450-550 yd target instead (asserted in the tests).

Each entry carries `{ id, name, emoji, rarity, tagline, kind, color }` for the client
(`color`: the trail, a hex number), plus `boost: true` on the rocket-type balls
(`rocket`, `fireball`, `titan`: a launch faster than the swing) and `payout` (the points
and coins multiplier; default 0.5, Gold 2).

`modifiersFor(id, assist?, { curses?, random? })` returns what `Game.shotMods` takes:

```js
{ id, launch(launch, ctx) -> launch, physics: {...options}, post(sim, ctx), gimmeFt, assist,
  curses: ['gust'], gust: { mph: 25, from: 'left' } | null, cupCurse: {...} | null }
```

`modifiersFor(null)` is a frozen set of no-ops. `ctx` is `{ putt: boolean }`. A trick id
passed as `id` is ignored (a trick is never your own ball).

### Tricks

A trick is played on the OPPONENT's next shot in a match and reaches that shot as a curse:
`arcade.shotMods(armedBallId, { curses: ['gust', 'tiny-cup'] })` (the match engine's call)
stacks any number of curses on one ball. Unknown ids and ball ids in `curses` are dropped;
each trick applies once.

- `gust`: `crossWindMps` across the aim line, the side picked by the state's `random`
  (`gust.from`). It is on top of the day's wind and scaled by `windScale`, so a
  Windcutter ignores it. A gusted shot is never called TERRIBLE / SLICE HOUSE.
- `tiny-cup`: multiplies the cup scales the shot would have had (a Magnet under a Tiny
  Cup is 12 x 0.25 = 3). The putting assist cannot undo it: `Game.handleShot` takes the
  bigger of the ball's own cup and the assist's, **then** applies `mods.cupCurse` (easy
  putting: radius 2.2 x 0.25 = 0.55, pace 1.7 x 0.45 = 0.77), and the putting window is
  halved under it ("Putting levels"). The tap-in distance is
  unchanged, so the curse costs at most the stroke.
- `fog`: `curses` carries it and nothing else changes.

Solo play has no opponent: tricks are never in the random grants, `grant` / `grantBalls`
skip them, a saved inventory drops them, and `arm('gust')` throws `ArcadeError`
`TRICK_NEEDS_OPPONENT` (unlimited mode included).

### Physics options

The scales are optional `simulateShot` opts, default 1, and at 1 the shot is bit-for-bit
the shot it was before (verified against the previous `lib/physics.js` on 60 shot /
option combinations, and again for v2 on 3276 over every club, three curves, four
surfaces, wind, slope and cup; pinned in `test/arcade.test.js`). A value that is not a
finite number `>= 0` is ignored.

| opt | Scales |
| --- | --- |
| `dragScale`, `liftScale` | Aerodynamic drag / lift |
| `gravityScale` | Gravity in the air (a Feather floats); the roll is untouched |
| `windScale` | The wind vector the ball feels |
| `bounceScale` | Restitution at each bounce |
| `keepScale` | Tangential speed kept at each bounce |
| `rollScale` | Rolling resistance (> 1 stops sooner) |
| `cupRadiusScale`, `cupMaxSpeedScale` | Cup capture radius (0.22 m) and maximum capture speed (3 m/s) |

`keepScale` is an addition to the requested list: without it a Sticky drive still skids
~6 yd, because a bounce keeps 55 % of its forward speed on a fairway.

The v2 extras are absent, `0` or `false` by default, and then nothing changes:

| opt | What it does |
| --- | --- |
| `crossWindMps` | A wind across the aim line added to the day's (+: from the left, pushing the ball right), scaled by `windScale` |
| `ignoreTrees` | `true`: no tree contacts |
| `waterSkips`, `waterSkipMaxDeg` | A ball landing on water skips (a `skip` event) while skips are left, it comes down at 55 deg or flatter (every full club does: 37 to 46 deg; a moonball does not) and has 6 m/s over the water. A skip keeps 90 % of its horizontal speed and comes up at 62 % of the speed it came down with (at least 3.6 m/s). Only the landing that sinks is a `water` event; `carryYd` is still the first touch |
| `ripBackYd` | The first landing (not in a bunker) turns straight into a roll back along the line it came in on, at 55 % of its landing pace but no more than takes it this many yards on that surface |
| `homing` | In the air, from 0.6 s on and at full strength from 1.8 s: lateral acceleration `-(0.5 x error + 1.41 x error rate) x homing` m/s^2 toward the aim line (a critically damped spring, error in metres), limited to 9 m/s^2. It moves the ball sideways only: carry changes by under a yard |

A `skip` is a new event type in `sim.events` (`{ type: 'skip', x, y }`); nothing else in
a shot result changes shape.

The play assists' options (`lib/playability.js PLAY_ASSIST.physics`, section "Play
assists"; absent, `0` or `false`: nothing changes):

| opt | What it does |
| --- | --- |
| `launchClearM`, `launchClearRiseM` | Launch clearance: within `launchClearM` metres of the strike, ground that meets a ball that is still climbing lifts it clear (2 cm) instead of stopping it, until `launchClearRiseM` metres (default 6) have been forgiven in all. A ball launched under 4 degrees: 10 m and 1.5 m. Out of a bunker: at least 10 m of rise, and that bunker's sand bounces and rolls as rough inside `launchClearM` |
| `softTrees` | `true`: a crown contact is a brush (`{ type: 'leaves', part: 'leaves' }`: 92 to 97 % of the speed kept, under 3 degrees of turn, 90 % of the spin, at most three a shot), trunks are 0.6 as thick, a rolling ball is not stopped by a crown |
| `treeFreeM` | No tree contact of any kind within this many metres of the strike |

## Assists

Stored in the arcade state (`assist`), applied whenever the layer is enabled.

| Field | Values | Default | Effect |
| --- | --- | --- | --- |
| `putting` | `'off'`, `'assist'`, `'easy'` | `'easy'` | How much a putt is helped ("Putting levels" below; the maths is `lib/putt-assist.js`). A match plays its own level |
| `dispersion` | 0..1 | 0.6 | HLA and spin axis of every non-putt are multiplied by this (1 = the real ball, 0 = dead straight). Stacks with Laser |
| `tapInFt` | 0..20, in 0.5 steps | 8 | A ball that stops on the green this close is holed for +1 stroke, **in place of** `settings.gimmeFt`. 0 = no tap-ins. The note reads `Tap-in inside 8 ft (+1)` |

A putt is decided before the launch is modified, by the test `simulateShot` makes: ball
on a green, VLA < 2, speed < 40 mph. Putts keep their own line.

`// PUTT-ASSIST HOOK` in `Game.handleShot` marks where `assistPutt` belongs: the launch
is validated and unmodified, `putt` is known, `mods.assist` holds the level, and
`this.ball`, `this.hole.pin`, `this.aimDeg`, `this.terrain`, `this.surfaceAt` and
`this.conditions` are at hand. The hook sits inside `if (mods)`, so it only runs while
the arcade layer is enabled.

`game.state().settings.gimmeFt` is unchanged by the arcade layer. A client that draws a
gimme circle should use `assist.tapInFt` from the arcade snapshot while `enabled`.

### Putting levels (`lib/putt-assist.js`)

On a green the game solves the putt that goes in (`solvePutt`: the read and the pace, by
rolling the real physics) and judges the stroke against it: its start line (HLA, measured
from the solved line: the player does not have to aim for the break) and its pace as a
ratio of the solved pace. The assist **helps a decent putt and does not rescue a bad one**:

| Level | Holed when the start line is within | and the pace is | A stroke outside that |
| --- | --- | --- | --- |
| `'off'` | (the real stroke at the real cup) | | |
| `'assist'` | 2.5 degrees | 85 % to 140 % of the right pace | is a miss: 55 % of its line error beyond the window and (pace beyond the window) ^ 0.6 are kept |
| `'easy'` (solo default) | 4.5 degrees | 80 % to 160 % | is a miss: 30 % and ^ 0.3 are kept, so it finishes closer |

- **Inside the window** the putt played is the solved one, give or take 4 % of the stroke's
  own errors, at a bigger cup (`cupRadiusScale` 2 / 2.2, `cupMaxSpeedScale` 1.5 / 1.7):
  it drops. `result.puttAssist.made` is `true`.
- **Outside it** the ball is steered to finish close and is played at no cup at all
  (`cupRadiusScale: 0`): if it still reaches the cup it passes at least 28 cm beside it
  (inside the 30 cm of a `robbed` callout), on the side the stroke erred to (the other
  side when a slope would bring it back over the cup). `made` is `false`. With the
  default tap-in (8 ft) most misses are a tap-in: a miss costs the stroke, not two.
- A stroke outside the window that **drops on its own** (as struck, at the real cup: a 6 ft
  putt 5 degrees off still catches the edge) is played as struck. The assist never takes a
  putt away, so no level holes fewer than the one below it.
- A putt struck at **three times the right pace never drops**, at any level (pace is read
  between 0.3 x and 3.5 x).
- A Tiny Cup trick halves the window (line and upper pace x the root of its cup scale):
  2.25 degrees and +30 % on easy.
- A **match plays its own level** (`options.putting`, default `'assist'`: docs/match.md),
  whatever the bay is set to; the server arms each match swing with it
  (`ArcadeState.shotMods(id, { curses, putting })`). Solo play uses the bay's own setting.

Make rates, measured (`node tools/arcade-dev/putt-rates.cjs`; 400 seeded putts a cell;
the stroke is the solved putt with the player's errors on it: start line N(0, sigma)
degrees, pace x exp(N(0, sigma))). `% holed / % left outside the 8 ft tap-in`:

| Player (line, pace) | Level | 6 ft | 15 ft | 30 ft | 45 ft |
| --- | --- | --- | --- | --- | --- |
| steady (1.5 deg, 10 %) | off | 93.3 / 0 | 70.3 / 0.5 | 38.5 / 12 | 27.5 / 28.5 |
| | assist | 94.8 / 0 | 88 / 0 | 85 / 0 | 84.8 / 0 |
| | easy | 98 / 0 | 98.3 / 0 | 99 / 0 | 98.8 / 0 |
| average (3 deg, 22 %) | off | 70.8 / 0 | 39.8 / 10.8 | 16.5 / 48.5 | 9 / 60.8 |
| | assist | 71.3 / 0 | 51 / 0.3 | 42.5 / 2 | 39.5 / 6 |
| | easy | 81 / 0 | 73.5 / 0 | 71.8 / 0 | 73.5 / 0.8 |
| wild (6 deg, 40 %) | off | 44 / 7 | 17.3 / 40 | 5.8 / 74 | 2.8 / 82.8 |
| | assist | 44.3 / 1.8 | 19.8 / 6.3 | 16.8 / 23 | 18 / 32.5 |
| | easy | 49 / 0 | 31.5 / 0.3 | 32.3 / 5.3 | 34.8 / 9.3 |

Across a 2 % slope the same players hole within a few points of that on `assist` and
`easy` (the read is solved for them) and far fewer on `off`. One stroke at a time from
30 ft on `easy`: 4 degrees off line at 0.8 x to 1.5 x the pace is in; 5 degrees off line
leaves 1.5 ft; 0.7 x the pace leaves 1.6 ft, 1.7 x 2.5 ft, 2 x 5.7 ft, 3 x 15.4 ft; 14
degrees off line leaves 1.9 ft. On `assist` 3 degrees off leaves 1.5 ft, 1.5 x the pace
3.9 ft, 3 x 47.7 ft. `test/putt-assist.test.js` pins the windows, the no-rescue rule, the
3 x rule and bounds on the make rates.

## Play assists (`lib/playability.js`, marked `v2:playability`)

The stages are vertical (cliffs, 100 m of relief, woods) and the players hit real balls
off a mat: they cannot punch out or pick the perfect club. The simulator's realism (a
bunker lip, ground rising in front of the ball, a crown in the way) produced dead shots
that read as bugs. While the arcade layer is **enabled** the game is played with
`PLAY_ASSIST` (`Game.playAssist`, set by the server; `BIRDIE_PLAY_ASSIST=0` keeps it
off); with the layer off, in a league round, or with `Game.playAssist` null it is the plain
simulator to the last bit (the audit below is identical before and after on 58,103 spots).
There is no separate setting: they are on with the layer.

| Assist | What it does | Numbers |
| --- | --- | --- |
| **Launch clearance** (`launchClearM`, `launchClearRiseM`) | For the first metres of travel, ground that rises into a ball that is still climbing passes under it: the ball is carried over the lip, the bump or the brow (its velocity untouched; the path stays above the ground). Past the rise budget it is a wall and stops the ball as ever; a ball coming down lands as ever | 35 m of travel, 6 m of rise in all. Topped (launched under 4 degrees): 10 m and 1.5 m (a lip, not a brow). Level open ground: bit-for-bit the plain shot |
| **Sand** | A ball struck out of a bunker always comes out: the bank above it is forgiven up to 10 m (a raised green's whole bank is its lip), and inside the 35 m the bunker it was hit from plays as rough, so even a skulled ball runs out. Landing in sand still kills the roll. There is no lie penalty on launch or speed in this simulator (sand and rough only ever acted through ground contact), so there was nothing to cap | 0 of 17,696 audited swings out of sand travel under 10 yd (1,004 did; 721 under 3 yd); the shortest goes 35 yd |
| **Soft trees** (`softTrees`, `treeFreeM`) | Leaves do not stop golf balls: a crown contact is a brush (a `leaves` event, not a `tree` one: no TIMBER!, no mishit) that keeps 92 to 97 % of the speed and turns the ball under 3 degrees, three times a shot at most. Trunks still stop and deflect (`tree` / `trunk`, TIMBER!), at 0.6 of their radius; a fir's skirt does not stop a rolling ball. Nothing at all touches the ball within 15 m of the strike. A Ghost ball still ignores trunks too | Temple Run, rough, 280 yd out, a 150 mph / 12 degree drive at the flag: carry 43 yd into a crown before, 199 yd now |
| **Aim range** (`aimLimitDeg`) | `Game.setAimOffset` reaches 90 degrees either side of the flag (45 plain); the slider, the arrows and the map drag follow `state.aimLimitDeg` (they stopped at 30) | 90 |
| **Rescue drop** (`drop`) | DROP ON THE LINE, below | +1 stroke, free out of a dead lie |

The lineup (`lib/predict.js`) predicts with the same options, so "ends in: Trees" is no
longer said of a shot the game will let through.

### Dead lies and the rescue drop

`lieReport(ctx, spot, { assist })` plays the swings a player would make from a spot: a
good one (driver 150 mph / 12 deg / 2500 rpm, 5-iron 130 / 16 / 5000, 7-iron 115 / 19 /
6500, wedge 90 / 28 / 9000, pitch 60 / 30 / 7000, chip 35 / 24 / 4000) and a duffed one
(80 % of the speed, 5 degrees lower) of every club that does not fly the hole by 30 yd or
cover under a quarter of the way, at the flag and 20, 40, 60 and 80 degrees either side,
in still air. The lie is **dead** when none of them gains 15 yd on the hole (and travels
10 yd) without a penalty; **stuck** when none even moves (the ground or a tree stops every
one: the kind that feels like a bug), else a forced carry (every swing that flies is wet
or out of bounds: the hole's design); **hard** when only one club family works.

**DROP ON THE LINE** (`Game.dropInfo()` / `dropOnLine()`): before any swing, the ball
may be moved to the nearest point of the hole's routing line (`hole.line`) that is

- no nearer the hole than the ball lies (the tee itself when the ball lies behind it),
- on fairway or tee turf (never water, sand, green or out of bounds), and
- a clear lie (candidates nearest first, 5 m apart, until one is not dead; else the tee).

It costs **one stroke**, or **nothing when the lie is dead** (`rescue`). The aim goes back
to the flag. It is taken back like a shot (`POST /api/mulligan`; no mulligan is counted).
No drop on the tee before a swing, on a green, in practice, in a league round, when the
ball already lies on that spot, or in a match's sudden death.

| Where | What |
| --- | --- |
| `game.state()` | `canDrop`, `rescue` (the lie is dead: the drop is free), `drop: { x, y, lie, free, cost, distToPinYd } \| null` (where the ball would go: the ghost marker), `aimLimitDeg`, `playAssist` |
| `POST /api/drop` | solo play. `{ ok, drop: { drop: true, free, rescue, penalty, from, end, lie, strokes, distToPinYd, note } }`; 409 with no drop to take, or in a match |
| `POST /api/match/drop` | `{ playerId? }`: the player who is up (docs/match.md) |
| SSE `drop` | the drop result (a match's: the engine's event with `match: true`), before the `state` that moves the ball |
| HUD (`public/arcade/arcade.js`) | `.arc-drop`: DROP ON THE LINE over the lie panel, bottom left (`R`; `D`, the first choice, is the game shell's DATA panel). A drop that costs a stroke takes two presses (the first arms it for 5 s: PRESS AGAIN: +1); a free one is a big green FREE DROP in the middle of the view, one press. `.arc-drop-ghost` marks the spot on the 3D view when it is in sight, and the aim map draws a dashed ring there. Banner FREE DROP / DROP · +1. Audio: `ui-tick`, `ui-confirm` (guarded) |

### The audit and the hole guard

`node tools/arcade-dev/playability-audit.mjs --both` samples every stage (a 12 m grid over
everything in bounds that is not water or green, 6 m within 15 m of a cliff or a tree, 3 m
in sand: 58,103 spots) and runs `lieReport` on each. dead / stuck / hard: % of spots;
flag: % of good swings straight at the flag that are stopped dead (no penalty, under 30 %
of the club's level carry); sand: swings out of sand (four clubs, good and duffed, at the
flag) travelling under 3 / under 10 yd.

```
                              | PLAIN SIMULATOR                    | ARCADE ASSISTS
stage             spots  sand | dead% stuck% hard% flag%  <3y <10y | dead% stuck% hard% flag%  <3y <10y  sand min
-----------------------------------------------------------------------------------------------------------------
lagoon-island      1059  1088 |     4   2.64   3.1  18.8  171  223 |   0.5      0   1.9   4.5    0    0  34.8 yd
canyon-run         2950  1672 |   0.6    0.1   2.9   8.4   47   94 |     0      0   2.6     2    0    0  38.3 yd
lighthouse-point   1453  2296 |   1.2      0   1.4   4.9   32   46 |   0.5      0   1.9     0    0    0  69.3 yd
volcano-drop       2736   184 |  31.1  19.96   9.7  78.7    6    8 |   0.2      0   1.2  46.9    0    0  65.5 yd
frostbite-ridge    8556  1224 |   0.5   0.12   0.6  19.6   23   48 |     0      0   0.3   2.2    0    0  81.2 yd
sakura-garden      3057    88 |   2.5   0.69     2  16.1    1    1 |   1.1      0   1.9   4.2    0    0  56.8 yd
temple-run         8108  1680 |   0.3    0.2   0.3  15.9   55  102 |     0      0   0.4   0.2    0    0  45.6 yd
pharaohs-gate      4276  5104 |     0      0   1.2   3.9   76  128 |     0      0   1.2   0.2    0    0  75.5 yd
midnight-mile      3847  1000 |   0.7   0.23   0.4   3.7    8   13 |   0.1   0.03   0.2     2    0    0  76.5 yd
sky-fortress       4664   616 |   6.9   0.39     9  13.8   13   26 |   3.4      0     2   9.6    0    0  80.8 yd
dragons-spine      6035   240 |   3.3    0.1   1.9  16.7    3    7 |     1      0   0.8   7.8    0    0  83.6 yd
summit-express     4716   288 |     3   0.42   2.8  22.4    8   14 |   0.5      0   1.7   7.4    0    0  80.6 yd
bullseye-bay       2140  1904 |  23.6   3.46   4.7  35.4  277  289 |  12.3      0   4.2  18.4    0    0  83.3 yd
thunder-dome       1454   312 |     0      0   0.8  15.2    1    5 |     0      0     0   0.5    0    0  76.4 yd
ice-pick           3052     0 |   0.7   0.36     2   8.2    0    0 |     0      0   1.8     0    0    0  -
-----------------------------------------------------------------------------------------------------------------
ALL               58103 17696 |   3.9   1.31   2.5  19.3  721 1004 |   1.0   0.00   1.2   6.1    0    0
```

Good swings at the flag stopped dead: 19.3 % (23,677 of 122,744; 5,807 by a tree) in the
plain simulator, 6.1 % (7,101; 56 by a tree) with the assists. What is left is real walls:
above all the crater of Volcano Drop (46.9 %: its slopes are far over the 6 m the
clearance forgives; another club or line gets out, so only 0.2 % of its spots are dead;
`launchClearRiseM` 8 also passes the hole suites, if it should be easier).
What is left dead is forced carries (Bullseye Bay's far shore, the foot of Sky Fortress),
every one a free drop. The plain audit is the same to the spot before and after the
assists were written (58,103 spots, 15 stages). `test/arcade-playability.test.js` is the guard: the audit on a
30 m grid with thresholds per stage (dead at most 2 %, more on the stages built round a
carry; stuck at most 0.25 %; no sand swing under 10 yd; every dead spot offers a free drop
to a clear lie), and the four hole suites run again with the assists on
(`test/helpers/play-assist-on.cjs`): the walls still block and the rocket routes are still
the rocket routes (77 of 77).

## Grading

`gradeShot({ result, before, practice, streak, powerup, theme, handed })`: `result` is
the shot result, `before` is `game.state()` from before the shot, `practice` is
`before.practice`, `theme` is `game.course.arcade.theme` (the server passes it: water on
a `volcano` stage is lava) and `handed` is `'RH'` (default) or `'LH'` (the game does not
know the player's hand today, so right is a slice and left is a hook).

`Game.handleShot` stamps what the arcade layer did on the result, for the grading and
the HUD (absent on a plain shot with the layer off):

```js
result.arcadeShot = { ball: 'rocket' | null, curses: ['gust'], gust: { mph, from } | null,
                      realLaunch: { speedMph, vla, hla, totalSpin, spinAxis },   // the monitor's own ball
                      cup: { radiusScale, maxSpeedScale } }                      // the cup it was played at
```

Grades, lowest to highest: `DISASTER`, `MISS`, `OK`, `GOOD`, `GREAT`, `PERFECT`, `JACKPOT`.

Checked in this order:

1. **Penalty, water, out of bounds**: `DISASTER`, 0 points. Reasons `Splash`, `Out of bounds`.
2. **Holed** (a real cup capture):
   - off the green, or any non-putt: `JACKPOT` (`HOLE IN ONE!` on a hole's first stroke,
     `Chipped in from 18 yd` from 40 yd or less, `Holed out from 164 yd!`)
   - a putt from over 15 ft: `JACKPOT` (`Drained it from 20 ft`); 15 ft or less: `PERFECT`
3. **A putt that missed**: 2 ft or less left `GOOD`; within the larger of 5 ft and 15 %
   of its length `OK`; else `MISS`. A conceded tap-in is at least `OK`.
4. **Practice games**, by their own scores:
   - `targets`: 10 / 5 / 3 / 1 / 0 points are `PERFECT` / `GREAT` / `GOOD` / `OK` / `MISS`
   - `chipping`: 5 / 3 / 2 / 1 / 0 points likewise (a chip-in is the `JACKPOT` above)
   - `closest`: inside 10 ft / 25 ft / 45 ft / 90 ft, else `MISS`
   - `ladder`: a cleared rung is `GREAT`, inside 3 yd `PERFECT`; within 15 yd `OK`
   - `putting`: as putts above
   - `range`, `longdrive`: the full-swing grade below (out of the grid caps at `MISS`,
     inside 5 yd of the range flag lifts to `GREAT`)
5. **A full swing.** Quality `q = 0.45 straight + 0.35 distance + 0.2 lie`:
   - straight, from |offline| / total: under 1.5 % = 1 (`Dead straight`), 4 % = 0.75,
     8 % = 0.45, 12 % = 0.2, beyond = 0 (`Way right`)
   - distance, carry against the club's typical carry (`CLUB_FULL` by `result.clubKey`,
     else the club nearest the ball speed): 108 %+ = 1 (`Piped it: +31 yd over your
     7-iron`), 97 % = 0.9 (`Full value`), 88 % = 0.65, 75 % = 0.35, below = 0.1 (`Chunked it`)
   - lie: fairway, tee or green = 1, rough = 0.5, bunker = 0.25
   - `q >= 0.9` `PERFECT`, `>= 0.72` `GREAT`, `>= 0.5` `GOOD`, `>= 0.3` `OK`, else `MISS`
6. **An approach** replaces step 5's grade. A round shot is an approach when the pin was
   within the club's range (`before.distToPinYd <= max(40, typical carry x 1.1 + 10)`):
   a par-3 tee shot, an iron in, a chip. Judged on where it finishes: inside 10 ft
   `PERFECT`, inside 25 ft `GREAT`, on the green `GOOD`, within the larger of 10 yd and
   15 % of the starting distance `OK`, else `MISS`. Distance against the club is not
   scored (a partial swing is not a mishit). In a bunker the "inside 10 / 25 ft" grades
   do not apply: it is a missed green (`OK` when close).
7. Any round shot that finishes farther from the pin than it started is capped at `MISS`.
8. A full swing that finishes in a bunker is `GOOD` at best (it never extends a streak).
9. A mishit (callout `shank`, `worm-burner`, `sky-ball`, `slice-house`, `hook-city`,
   `chunk` or `terrible`, also when a tree or a streak took the callout itself) is `MISS`
   at best and gets the tag `mishit`, unless the ball lucked its way to the pin (one of
   the at-the-pin callouts below). A topped drive that runs 100 yd down the fairway used
   to grade `GOOD`.


**The swing is graded, not the wind.** On an arcade shot in wind the game flies the same
swing again in still air (`lib/game.js` `_play`) and carries the difference on the result
as `sim.windDriftYd`: how far off the aim line the day's wind took this ball. `gradeShot`
takes it out of `offlineYd` before it judges straightness, the off-line callouts
(`terrible`, `slice-house`, `hook-city`) and the `facts`, so a drive aimed 40 yd left to
ride a 22 mph crosswind onto the fairway is not "way right", and a real slice that the wind
blows back to the middle is still a slice. (A Gust trick is excluded the same way by
`gusted`.) Without the arcade's mods, in still air, or on a putt nothing is measured.
### Callouts

Every graded shot carries `callout: { id, text, tone, voice } | null`: the single loudest
thing to say about it. `CALLOUTS` (id -> `{ text, tone }`, also in the snapshot as
`callouts`) holds the thirty ids and texts of the contract; `voice` is the id. Tones:
`epic`, `good`, `neutral`, `bad`, `funny`. The numbers live in `CALLOUT_RULES`.

Definitions: **offline** is `sim.offlineYd`, the ball's final sideways distance from the
aim line through where it was hit (+ right). A **putt** is `sim.isPutt`. A **chip** is a
non-putt from 40 yd or less (or the chipping game) struck under 70 mph. A **tee shot** is
a full swing that is a hole's first stroke on a par 4 or 5, or, in the range and long
drive games, any ball of 100 mph or more or with a driver / wood / hybrid named. Launch
numbers are the monitor's own (`arcadeShot.realLaunch`): the dispersion assist plays a
25 deg shank as 15 deg, and it is still a shank. Spin axis is the one flown.

The first rule that matches wins:

| # | id | Tone | When |
| --- | --- | --- | --- |
| 1 | `hole-in-one` | epic | Holed, not a putt, on a hole's first stroke (or the closest-to-the-pin game's ace) |
| 1 | `chip-in` | epic | Holed, not a putt, from 40 yd or less |
| 1 | `holed-out` | epic | Any other holed non-putt |
| 1 | `drained` | epic | A putt holed from over 15 ft |
| 1 | `in-the-hole` | good | Any other holed putt |
| 2 | `lava` | funny | Water, when `theme === 'volcano'` |
| 2 | `splash` | bad | Water |
| 2 | `ob` | bad | Out of bounds |
| 3 | `unstoppable`, `on-fire` | epic | The shot that takes the streak to 5 / to 3 (a `GREAT`, `PERFECT` or `JACKPOT` with 4 / 2 going in). Only a holed shot or a hazard outranks it |
| 4 | `robbed` | neutral | Not holed, and the rolling ball (a putt all the way, any other shot after its last bounce) passed within 30 cm of the pin, or within 12 cm of the edge of the cup it was played at when that is farther out (easy putting: 60 cm), still moving at 0.4 to 2.5 m/s |
| 4 | `so-close` | neutral | A putt that stops within 1 ft (conceded tap-in or not) |
| 4 | `pin-seeker`, `dart` | epic, good | Not a putt or a chip: finishes inside 3 ft / inside 10 ft of the pin (round) or the flag (range, targets, ladder, closest) |
| 4 | `bomb` | epic | Would be `dance-floor`, and is a bomb as below: a driven green is a bomb first |
| 4 | `dance-floor` | good | Finishes on the green from over 100 yd (round, closest to the pin) |
| 4 | `so-close` | neutral | A chip that stops within 1 ft |
| 5 | `timber` | funny | The sim hit a tree (`tree` event), whatever else the shot was |
| 5 | `shank` | funny | Real HLA of 20 deg or more, at 35 mph or more |
| 5 | `worm-burner` | funny | Not a chip: 60 mph or more and an apex under 9 ft |
| 5 | `sky-ball` | funny | A tee shot launched at 28 deg or more (not with an 8-iron or shorter named) that carries under 70 % of the named wood's distance (long drive: the driver's); with no club named, on a hole of 230 yd or more, under 170 yd |
| 5 | `slice-house`, `hook-city` | funny | A tee shot finishing more than 30 yd right (left) of the line with at least 3 deg of slice (hook) spin axis as flown. Never under a Gust trick |
| 5 | `chunk` | funny | Not on the range: a named club carrying under 60 % of its distance when the target is out of its reach (so not a partial swing); or a shot at a pin 15 to 230 yd away that covers under 60 % of the way and leaves over 40 % |
| 5 | `terrible` | bad | A full swing (not a putt, not a chip) finishing more than 30 yd off line that is none of the above. Never under a Gust trick |
| 5 | `beach` | funny | Finishes in a bunker |
| 6 | `blast-off` | good | A full swing with a rocket-type ball (`rocket`, `fireball`, `titan`) |
| 6 | `bomb` | epic | A tee shot, no rocket-type ball or Feather, no tree: carry of 290 yd or more, or 112 % of the driver's / wood's typical carry and at least 230 yd |
| 6 | `striped` | good | A tee shot offline by under 1.5 % of its distance, on the fairway or green (range: within 15 yd of the line), with 85 % of the club's carry, not with a Laser, Homing or Titan ball |
| 7 | `perfect`, `great-shot`, `nice-shot` | epic, good, good | Grade `PERFECT` / `GREAT` / `GOOD` (a missed putt: `nice-shot` only for a lag from 20 ft or more) |

Anything else (`OK`, `MISS`, a penalty with no water or out of bounds) has no callout.
A putt can only get rows 1, 4 (`robbed`, `so-close`) and `nice-shot`; a chip never gets
`bomb`, `striped`, `slice-house`, `hook-city`, `sky-ball`, `terrible`, `pin-seeker`,
`dart` or `dance-floor`. Checked with realistic launch data in `test/arcade.test.js`: a
10, 18 or 25 yd miss off the tee is `great-shot` / `nice-shot`, a 35 yd slice is
`slice-house`, the same miss with a 7-iron from the fairway is `terrible`.

The grade also carries `curses` (the tricks the shot was hit under), `gust`
(`{ mph, from }` or null) and `facts` (the shot in numbers, for the challenges).

### Points, coins, XP

- Base points by grade: `JACKPOT` 1000, `PERFECT` 850-950, `GREAT` 650-750, `GOOD`
  450-550, `OK` 250-350, `MISS` 80-180, `DISASTER` 0 (the spread is quality within the grade).
- `points = round(basePoints x streak multiplier x power-up multiplier)`:
  streak multiplier `min(3, 1 + 0.25 x streak going into the shot)`, power-up
  multiplier 0.5 when one was used, 2 for a Gold ball.
- `coins = round(points / 10)` plus 100 for a `JACKPOT`, 25 for a `PERFECT`, 10 for a
  `GREAT`. A Gold ball pays exactly twice a plain ball's coins, bonus included.
- XP awarded = points.

## Economy (`ArcadeState`)

- **Streak**: `JACKPOT`, `PERFECT` and `GREAT` extend it; `GOOD` and `OK` hold it;
  `MISS` and `DISASTER` reset it to 0.
- **Levels**: level L starts at `500 x (L - 1) x L` XP (1000, 3000, 6000, 10000, ...).
- **Grants** (random, weighted per ball: common 60 / rare 30 / epic 10, over the fifteen
  balls: six common, five rare, four epic; never a trick):
  - every third step of a streak (the shot that takes it to 3, 6, 9, ...): one ball
  - each level gained: two balls
  - a `JACKPOT`: one rare or epic ball
- **Starting inventory**: one `rocket`, one `magnet`.
- **Arming**: `arm(id)` needs one in the inventory. The armed ball is consumed by the
  next shot only. If that shot is rejected (bad ball data, hole already finished) the
  ball is refunded and stays armed. A trick cannot be armed (`TRICK_NEEDS_OPPONENT`).
- **Unlimited** (`setUnlimited(true)`, `POST /api/arcade/settings { unlimited }`, key U):
  party mode. Every ball can be armed whether it is owned or not and the inventory is
  never counted down: it means "never runs out", not "stays armed". The armed ball is
  still spent from the armed slot by its shot (`consumeArmed()` returns the id and clears
  `armed`), so the chip or putt that follows is a plain ball until one is armed again.
  Kept across a restart and a `reset()`.
- **League rounds** are played with a plain ball under the round's own rules: no
  power-up is consumed and no assist applies, though the shot is still graded and paid.
- **`reset()`** wipes coins, XP, level, streak, inventory (back to the starting two),
  history and the challenges. It keeps `enabled` and `assist`.

Hooks for the match engine (each saves and returns the snapshot):

- `arcade.grantBalls(ids)`: one ball per id (an id or a list) onto the bay's shelf.
  Tricks and unknown ids are skipped.
- `arcade.addCoins(n)`: adds whole coins to the bay's wallet; a negative `n` spends, the
  balance never goes below zero, anything that is not a number is ignored.
- `arcade.shotMods(ballId, { curses })`: the mods for a match shot (see Tricks). The
  match never calls `consumeArmed()`; the bay's inventory is not touched.

### Challenges

Three are live at a time, in the snapshot as
`challenges: [{ id, text, progress, goal, done, reward: { coins, balls: [ids] } }]`.
`applyShot` moves them on with every shot `gradeShot` graded (its `facts`); a grade
without `facts` moves nothing. A finished challenge is paid at once (its coins, one of
each ball), reported once in that shot's `award.challenges` (with `done: true`), and
replaced by the next one in the pool that is not live. There is no claim step.

The pool (`CHALLENGES`, drawn in this order, then round again):

| id | Text | Counts | Reward |
| --- | --- | --- | --- |
| `fairways-3` | Hit 3 fairways in a row | Tee shots finishing on fairway or green; a tee shot that misses starts again | 150, `bouncy` |
| `inside-10` | Stick one inside 10 feet | Not a putt or a chip | 200, `sticky` |
| `great-5` | Hit 5 GREAT shots or better | | 200, `windcutter` |
| `carry-200` | Carry a drive 200 yards | A tee shot, no rocket-type ball | 100 |
| `putt-10` | Hole a putt from 10 feet or more | A real cup capture | 200, `yoyo` |
| `straight-3` | Hit 3 dead-straight shots | Full swings offline under 1.5 % | 150, `titan` |
| `greens-3` | Hit 3 greens from 100 yards or more | | 250, `feather` |
| `streak-4` | Build a streak of 4 | The streak after the shot | 300, `magnet` |
| `yards-1500` | Rack up 1,500 yards of carry | Every dry non-putt | 150, `moonball` |
| `close-3` | Finish 3 shots inside 25 feet | Non-putts | 200, `ghost` |
| `perfect-2` | Hit 2 PERFECT shots | `PERFECT` or `JACKPOT` | 250, `laser` |
| `putts-3` | Hole 3 putts | Real cup captures | 150, `skipper` |
| `carry-250` | Carry a drive 250 yards | A tee shot, no rocket-type ball | 300, `fireball` |
| `clean-6` | Play 6 shots in a row with no MISS | A `MISS` or `DISASTER` starts again | 200, `skipper` |
| `chip-3ft` | Chip one inside 3 feet | A chip; holing it counts | 150, `sticky` |
| `points-5000` | Score 5,000 points | | 200, `rocket` |
| `powerups-3` | Play 3 power-up balls | | 100, `bouncy` |
| `dance-150` | Find the green from 150 yards or more | | 300, `gold` |
| `fairways-5` | Hit 5 fairways | Tee shots | 200, `windcutter` |
| `inside-3` | Stick one inside 3 feet | Not a putt or a chip | 400, `homing` |
| `bomb` | Hit an ABSOLUTE BOMB | The `bomb` callout | 400, `rocket` |

Persisted to `<BIRDIE_DATA_DIR>/arcade.json` as `{ "version": 2, "state": {...} }`,
written whole through a temp file and a rename on every change. A missing file starts a
new player. A file that is not JSON is moved to `arcade.json.corrupt`. Hand-edited
values are cleaned on load (unknown power-ups and tricks dropped from the inventory,
level recomputed from XP, unknown challenges dropped). A version 1 file (before the
challenges) loads as it was, with the first three challenges live, and becomes version 2
at the next change.

## Wind on arcade stages

"The day's wind" on an arcade stage is a wind ROLLED for the hole (`lib/arcade-wind.js`,
`docs/match.md` section "Wind"; stream wind). Loading a course whose `arcade` block names a
`theme` rolls a whole speed inside the stage's range (`course.arcade.wind { min, max }`,
else `conditions`: calm 0 to 5, breezy 6 to 12, windy 12 to 22 mph) from a random
direction and puts it on the game's conditions (steady, standard air); `POST /api/reset`
and `POST /api/next-hole` roll again; a match rolls one per hole. The player's own
conditions are held aside and are back with the next course that is not an arcade stage
(`GET /api/conditions` answers `stageWind` and `day`). The HUD's wind dial and the lineup
read the game's conditions, so they show the rolled wind. The Windcutter ignores it and a
Gust comes on top of it, as with any wind. Real courses and the three-hole Arcade Classics
are untouched.

## Routes

| Route | Body | Answer |
| --- | --- | --- |
| `GET /api/arcade` | | the snapshot (below) |
| `POST /api/arcade/arm` | `{ "id": "rocket" }` or `{ "id": null }` | `{ ok, armed, enabled, assist }`; 400 `{ ok: false, error, code }` with code `UNKNOWN_POWERUP`, `NOT_OWNED` or `TRICK_NEEDS_OPPONENT` |
| `POST /api/arcade/settings` | `{ "enabled"?: boolean, "assist"?: { "putting"?, "dispersion"?, "tapInFt"? } }` | `{ ok, armed, enabled, assist }`; 400 with code `BAD_ASSIST` (numbers out of range are clamped, not refused) |
| `POST /api/arcade/reset` | | `{ ok: true }` |
| `POST /api/drop` | | the rescue drop in solo play ("Play assists"): `{ ok, drop }`, 409 with none to take |

Every POST that succeeds broadcasts `arcade-state` (`/api/arcade/settings` also `state`: the
play assists follow `enabled`). `game.state()` and `GET /api/state` carry nothing about the
arcade but the play assists' fields (`playAssist`, `aimLimitDeg`, `canDrop`, `rescue`,
`drop`).

## SSE events (`GET /events`)

| Event | When | Data |
| --- | --- | --- |
| `arcade-state` | once on connect (after `state` and `lm`); after arm, settings, reset; when an armed ball is refunded | the snapshot |
| `arcade` | after every shot while enabled, between that shot's `shot` and `state` events | the shot's arcade result (below) |
| `drop` | a rescue drop was taken (`POST /api/drop`, `POST /api/match/drop`), before the `state` that moves the ball | `{ drop: true, free, penalty, from, end, lie, strokes, ... }` |

The same arcade result is also on the shot itself as `result.arcade` (in the `shot`
event). With the layer disabled there is no `arcade` event and no `result.arcade`.

### Snapshot (`GET /api/arcade`, `arcade-state`, `arcade.state`)

```json
{
  "enabled": true,
  "assist": { "putting": "easy", "dispersion": 0.6, "tapInFt": 8 },
  "coins": 123,
  "xp": 975,
  "level": 1,
  "streak": 1,
  "bestStreak": 1,
  "shots": 2,
  "inventory": { "magnet": 1 },
  "armed": null,
  "history": [
    { "shotId": 2, "grade": "PERFECT", "points": 425, "powerup": "rocket", "at": 1794723201762 },
    { "shotId": 1, "grade": "GOOD", "points": 550, "powerup": null, "at": 1794723201275 }
  ],
  "challengeCursor": 3,
  "challengesDone": 0,
  "levelXp": 975,
  "levelSpan": 1000,
  "nextLevelXp": 1000,
  "powerups": [
    { "id": "rocket", "name": "Rocket", "emoji": "🚀", "rarity": "epic", "tagline": "Strap a booster to it. A normal drive flies 500 yards.", "kind": "ball", "color": 16734751 }
  ],
  "callouts": { "slice-house": { "text": "SLICE HOUSE!", "tone": "funny" } },
  "challenges": [
    { "id": "fairways-3", "text": "Hit 3 fairways in a row", "progress": 1, "goal": 3, "done": false, "reward": { "coins": 150, "balls": ["bouncy"] } }
  ]
}
```

- `inventory` lists only balls the player owns (count >= 1); never a trick.
- `history` is newest first, at most 20.
- `levelXp` / `levelSpan` is the progress bar: XP into the current level, of the XP
  the level spans. `nextLevelXp` is the total XP at which the next level starts.
- `powerups` is the whole catalogue (eighteen entries: fifteen `kind: "ball"`, then the
  three `kind: "trick"`), in display order. `color` is the trail's, a hex number.
- `callouts` is every callout id with its text and tone (thirty entries).
- `challenges` is the three live ones; `challengesDone` counts the finished ones.

### Shot result (`arcade` event, `result.arcade`)

```json
{
  "shotId": 2,
  "grade": "PERFECT",
  "label": "PERFECT SHOT!",
  "points": 425,
  "basePoints": 850,
  "multiplier": { "streak": 1, "powerup": 0.5, "total": 0.5 },
  "coins": 68,
  "reasons": ["Dead straight", "Piped it: +245 yd over your driver", "In the rough"],
  "tags": ["straight", "piped", "rough", "big-gain", "powerup:rocket"],
  "quality": 0,
  "callout": { "id": "blast-off", "text": "BLAST OFF!", "tone": "good", "voice": "blast-off" },
  "curses": [],
  "gust": null,
  "facts": { "tee": true, "putt": false, "chip": false, "holed": false, "hazard": false, "fairway": false, "lie": "rough", "straight": true, "carryYd": 496.6, "totalYd": 512.2, "offlineYd": 0, "fromYd": 437.4, "leftFt": 224.4, "fromFt": 1312.2, "boosted": true },
  "powerup": "rocket",
  "award": {
    "awarded": { "coins": 68, "xp": 425, "points": 425 },
    "levelUp": false,
    "level": 1,
    "granted": [],
    "streak": 1,
    "challenges": []
  },
  "state": { "...": "the snapshot after this shot" }
}
```

- `callout` is `null` when there is nothing to shout. `curses` and `gust` say which
  tricks the shot was hit under (`gust`: `{ "mph": 25, "from": "left" }`).
- `award.challenges` lists the challenges this shot finished (already paid), each in the
  snapshot's shape with `done: true`.

- `label`: `JACKPOT!`, `PERFECT SHOT!`, `GREAT SHOT`, `GOOD`, `OK`, `MISS`, `DISASTER`.
- `points` already includes the multipliers; `multiplier.streak` uses the streak going
  into the shot, `award.streak` is the streak after it.
- `reasons`: short strings, most important first.
- `tags` (for sound and effects; any subset): `straight`, `wayward`, `piped`, `chunk`,
  `fairway`, `rough`, `bunker`, `green`, `approach`, `inside-10ft`, `inside-25ft`,
  `big-gain`, `backwards`, `putt`, `tap-in`, `holed`, `hole-out`, `chip-in`, `ace`,
  `long-putt`, `water`, `ob`, `penalty`, `climbed`, `out-of-grid`, `mishit`, `on-fire`
  (streak of 3+ going in; the `on-fire` callout is the shot that reaches 3),
  `powerup:<id>`.
- `quality`: 0..1, how good the shot was within its grade.
- `powerup`: the id used on this shot, or `null`.
- `award.granted`: ids of the power-ups this shot earned (already in `state.inventory`).
- On a shot with a power-up, `result.launch` is the modified launch (a Rocket shows
  225 mph for a 150 mph swing). The bag still records the monitor's real ball data.
