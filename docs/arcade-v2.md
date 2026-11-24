# Sim Clash: how to play

A golf video game for a real launch monitor: two players in one bay, real swings, a new
world on every hole. It also plays alone, and it can be tried with no launch monitor at
all. This page is the player's guide and the honest list of what is known to be rough.

The reference documents: the rules in full are in `docs/match.md`, the balls and the
grading in `docs/arcade.md`, the stages in `docs/arcade-holes.md`, the look in
`docs/arcade-look.md`, the camera and slow motion in `docs/arcade-feel.md`, the sound in
`docs/arcade-voice.md`, the menus in `docs/sim-clash-shell.md`, launch monitors in
`docs/launch-monitors.md` and `docs/foresight-bridge.md`.

## Starting

Start the game: the **Sim Clash** shortcut of an installed copy, or from source
`Sim Clash.bat` (or `npm start`). It opens full screen (**F11** or **Alt+Enter** switches
to a window and back) on its **title screen**. Any key, a click, or a real swing moves on.

The first time, the **connection wizard** comes next: it asks which launch monitor you have
and shows the steps for that one, with a live status light. Follow it, or SKIP FOR NOW; it
is always under SETTINGS > LAUNCH MONITOR > SET UP MY LAUNCH MONITOR.

Then the **main menu**. Arrow keys and Enter, the number keys, the mouse or a touch screen
all work; **Esc** always steps back one level.

| | | |
| --- | --- | --- |
| 1 | **VERSUS** | two players, head to head: the match lobby |
| 2 | **SOLO** | one player: a tour of 3, 6 or all 12 stages for a score, or any single stage |
| 3 | **PRACTICE** | free play on any stage, and three mini games |
| 4 | **PLAYERS** | the roster: add, rename, remove; rank, trophies, wins and losses, tour best |
| 5 | **SETTINGS** | sound, volume, announcer, shot camera, putting, straighter shots, tap-ins, graphics, launch monitor, credits |
| 6 | **HOW TO PLAY** | four pages: the game, the modes, the balls, the keys |
| 7 | **QUIT** | closes the game (the desktop app only) |

The shortest way into a match is three presses: any key, Enter (VERSUS), Enter (START).

A swing while the title or a menu is up is never played, counted or charged: on the title
it only means "press any key".

## Launch monitors, and playing without one

The chip in the corner reads **WAITING FOR A LAUNCH MONITOR** (in play: Monitor waiting)
until a connector is attached, then **LAUNCH MONITOR CONNECTED** with the way the shots
come in.

- The game listens on TCP port 921 and speaks GSPro Open Connect: a connector that sends
  shots to GSPro's Open API can send them here when GSPro is closed. GSPro's own built-in
  connections for most launch monitors cannot be pointed at this game: `docs/launch-monitors.md`
  lists every launch monitor we know about, in four tiers, with what has really been tried
  (one unit so far).
- **Foresight GC** units come in through the Foresight bridge built into the game: start
  the game, open GSPconnect from your own GSPro folder, connect the launch monitor in it,
  hit a ball. GSPro itself must be closed. Experimental; SETTINGS > LAUNCH MONITOR shows
  what the bridge is doing and has its Auto / On / Off switch (`docs/foresight-bridge.md`).
- **No launch monitor:** the **TEST SWING** button (bottom right, while no monitor is
  connected) plays a sensible shot for wherever the ball lies. The arrow beside it, or
  **T**, opens the list: SMART SWING, DRIVE, IRON, WEDGE, CHIP, PUTT (keys 1 to 6 while the
  list is open) and SLIDERS for any ball speed, launch, direction and spin. A test swing is
  a shot like any other: it is graded, it scores, it wins and loses holes, so two people
  can play a whole match with the mouse. With a monitor connected the list is still behind
  **T**.

## Versus

1. Main menu, **VERSUS**. The lobby opens with two players ready (Player 1 and Player 2
   are made on the spot when the roster has fewer than two). Tap a player slot to pick
   somebody else or type a new name.
2. Pick a format and, for a quick match, a stage (or leave it on Random). **OPTIONS** holds
   the rest: tied holes (sudden death / halve), power-ups (loadout / unlimited / off),
   putting (easy / assisted / real), stage order (tour / shuffle), hazard loses the hole.
3. **START**. The VS screen flips a coin for the honour, the stage introduces itself (par,
   yards, the wind for this hole, its three routes), and the first player is called up.
   Any key or a click skips an intro screen.

A match in play shows as a bar at the foot of the lobby (**RESUME** / **QUIT MATCH**).

| Format | Holes | Wins | Charges each |
| --- | --- | --- | --- |
| Quick Match | one stage | the hole | 2 |
| Best of 3 | stages 1, 2, 3 of the tour (or shuffled) | first to 2 | 3 |
| Tournament (best of 9) | the first nine tour stages in order (or shuffled) | first to 5 | 6 |

The match ends the moment it is won. The winner screen shows the awards (longest drive,
closest to the pin, shot of the match, most perfects), trophies, coins and a chest of balls
for the bay, and **REMATCH / NEW MATCH / EXIT**. Matches are friendly: there are no stakes.

### Rules

- **Who plays.** The coin decides the first tee; after that the winner of the last hole has
  the honour. Both tee off, then whoever is farther from the hole plays. When both balls are
  on the green the player with fewer strokes putts first.
- **Knockout.** The moment a player can no longer tie the hole, it is over. If your opponent
  is in with N and you have already taken N, you lose on the spot. If you have taken N-1 you
  get exactly one swing and it must drop (**MUST MAKE THIS**).
- **The stake line.** The header and the turn banner say what the next swing is for:
  **PUTT IN TO WIN**, **CHIP IN TO WIN**, **PUTT IN TO TIE**, **HOLE IT TO WIN**. The ball
  that wins the hole gets the **FOR THE WIN!** stamp.
- **Stroke cap.** Par + 3. Reach it without holing out and you lose the hole (both capped:
  the hole is tied).
- **Tied hole: sudden death.** Straight to an arena (Bullseye Bay, Thunder Dome, Ice Pick):
  one ball each, closest to the pin wins the hole. Water or out of bounds is a miss and
  loses to any ball on land. Both miss, or inside 0.1 ft of each other: again. (With ties
  set to **halve**, tied holes are halved and only a level match goes to sudden death.)
- **Match point** is flashed when the next hole can win it, for one player or both.
- **No mulligans** in a match. Either player can concede (the tab under the header).
- **Wind** is rolled for every hole inside the stage's own range (Sakura Garden 0 to 7 mph,
  Lighthouse Point and Summit Express 10 to 22; `docs/arcade-holes.md` has them all) and is
  the same for both players. The stage intro shows it big; the Auto aim allows for it. Shots
  are graded on the swing: what the wind did to the ball is not held against you.

### The match menu

**Esc** or **M**, or the MENU tab under the header. Swings still count while it is open.

| Key | |
| --- | --- |
| 1 | Resume |
| 2 | **Undo last shot**: takes the last swing back (it never happened) |
| 3 | **Drop on the line** (when there is one to take; see below) |
| then | **Restart hole**: both players back on the tee (asks once) |
| | **Restart match**: same players and format, from the top (asks once) |
| | **Exit to main menu**: no result (asks once) |

**Stray ball?** A swing under 40 mph from a full-shot lie counts, but the game asks at
once: **U** undo, **C** count it. The prompt goes away by itself after eight seconds.

## Solo

Main menu, **SOLO**. PLAYING AS shows who the score is kept for (left and right change the
player).

- **SPRINT** (3 stages), **HALF TOUR** (6), **FULL TOUR** (all 12): the tour's stages one
  after another, for a total against par. Your best total is kept per player and per
  length.
- **SINGLE STAGE**: any of the 12 stages or the 3 arenas, for a score. The best is kept per
  player and per stage.

Everything the arcade gives stays on: callouts, coins, balls, streaks, challenges, the
rolled wind, the free rocket on a rocket hole. Strokes count as on a card:

- A stage ends when the ball is holed; or, so nobody is stuck on one hole for ever, it is
  picked up automatically at par + 6 strokes (and then counts one more); or **GIVE UP THIS
  STAGE** in the pause menu, which costs the strokes so far plus one and never less than
  par + 4.
- **No mulligans** in a scored run. A drop on the line costs its stroke like anywhere else
  (a free drop costs nothing).
- The **pause menu** is the MENU button in the header, or **Esc**: RESUME, RESTART STAGE
  (a single stage or free play) or RESTART TOUR, GIVE UP THIS STAGE, SETTINGS, EXIT TO MAIN
  MENU. Items that throw a score away ask once.

After each stage a card shows the score by name, the points and what is next; at the end,
the results: to par, every stage, the three best shots, and NEW BEST SCORE when it is one.

## Practice

Main menu, **PRACTICE**, then a stage. Nothing counts.

| Game | | Where |
| --- | --- | --- |
| **FREE PLAY** | play the stage; hole out and it tees up again; mulligans allowed | any stage |
| **CLOSEST TO THE PIN** | 5 balls, your best one counts | par 3 stages and arenas up to 240 yards |
| **PUTTING CHALLENGE** | 9 putts from 3 to 40 feet | any stage |
| **UP AND DOWN** | 6 chips from off the green | any stage |

## Putting

Launch monitors read putts poorly, so the game helps, and how much is a setting:

| Level | A putt drops when | Where it is the default |
| --- | --- | --- |
| **EASY** | it starts within 4.5 degrees of the line and its pace is 80 % to 160 % of the right one | solo and practice (SETTINGS > PUTTING) |
| **ASSISTED** | within 2.5 degrees, pace 85 % to 140 % | a match (the lobby's OPTIONS) |
| **REAL** | your own stroke, at the real cup | |

The game solves the putt that goes in, so a putt needs pace more than line: you do not
have to aim for the break. A putt outside the window is a miss that finishes close, and a
putt struck at three times the right pace never drops. **TAP-INS GIVEN** (off, 3, 5 or
8 ft; 8 by default) picks up a ball that close. On ASSISTED a must-make putt can be
missed: an average putter holes about 4 in 10 from 30 feet.

## Drop on the line (key R)

Stuck behind a cliff, in the trees or in deep rough? When the ball is at rest and it is
your swing, the **DROP ON THE LINE** button appears at the left: the ball goes back on the
hole's line of play, on fairway or tee turf, no nearer the hole. A marker on the ground
shows where.

- It costs **one stroke**: press the button (or **R**) once to arm it, again to take it.
- When the game judges the lie **dead** (no realistic swing gets out of it), the button
  turns green and reads **FREE DROP**: one press, no penalty.
- There is none on the green, on the tee before the first swing, or in a sudden death.
- In a match it is also in the match menu, for the player who is up, and it can be undone
  like a shot.

## View from above (key V)

Some targets cannot be seen from behind the ball: the green is over a ridge or far below.
**VIEW FROM ABOVE** (the button at the top left, or **V**) flies the camera up to a high
view of the way from the ball to the pin; press again to come back down. Holding **V** is a
peek: up while it is held, down on release. When nothing behind the ball can see the
target the camera goes up by itself and the button says so. A ball struck while the camera
is up is followed from wherever the camera is: it never delays a swing.

## Balls and tricks

In a match, one charge buys any ball or trick, each once a match (unlimited: no limits).
The dock at the bottom is the loadout of whoever is up: keys **1** to **9** for the bar,
**Shift+1** to **9** for the next nine, **B** for the whole bag with what each one does.
The ball on the grass takes the armed ball's look. A ball is spent by its shot: arm one
again for the next.

| Ball | |
| --- | --- |
| Rocket | Strap a booster to it. A normal drive flies 500 yards. |
| Sticky | Lands and stops dead. |
| Magnet | The cup is three yards wide. Get it close and it drops. |
| Windcutter | Never feels the wind. |
| Laser | Dead straight: most of your slice, gone. |
| Moonball | Into orbit, down like a feather. |
| Bouncy | Hits the ground and keeps on going. |
| Fireball | Hot and low, lands running: a hundred yards of roll. |
| Ghost | Flies straight through trees. |
| Skipper | Skips across water like a flat stone. |
| Yo-Yo | Lands, bites, rips back twenty yards. |
| Homing | Bends back to your line in the air. |
| Titan | A quarter more speed and no curve at all. |
| Feather | Floats for ever, lands soft, stays. |
| Gold | Double points, double coins. |

| Trick (played on your opponent's next swing) | |
| --- | --- |
| Gust | A 25 mph crosswind on their shot. Left or right? Nobody knows. |
| Tiny Cup | Their cup shrinks to a quarter. |
| Fog | Their yardages vanish. |

Solo and practice use the bay's own shelf (earned with streaks, level-ups, jackpots,
challenges and match chests). **U** switches unlimited balls on or off outside a match:
every ball, never runs out, but each shot still spends the armed ball.

## Rocket holes

Sky Fortress (par 3, 427 yd, 50 m up), Dragon's Spine (par 4, 604 yd) and Summit Express
(par 5, 700 yd, 70 m up) cannot be played with a plain ball: every player's tee shot is a
**free Rocket** (no charge; a ball you armed yourself is kept for the next shot). In a match
they come up in a quick match (pick one, or Random) and in a shuffle, not in the tour order.
In solo they are stages 10 to 12 of the full tour: the dock says FREE ROCKET BALL on the tee.

## Keys

| Key | |
| --- | --- |
| Left / Right (Shift: bigger steps) | aim |
| A / 0 | auto aim / aim straight at the pin |
| 1 to 9, Shift+1 to 9, B | arm a ball, the next nine, the ball bag |
| V | view from above (tap: up or back down; hold: peek) |
| R | drop on the line (twice when it costs a stroke; once for a free drop) |
| T | test swing: the list of swings; 1 to 6 pick one while it is open |
| D | show or hide the shot data panels (the last shot's numbers, the club card) |
| F | fly over the hole |
| Esc | the match menu, or the pause menu in solo and practice; in the menus, one step back |
| M | the match menu (in a match); take the last shot back (free play) |
| U / C | undo / count a stray ball (while the prompt is up, in a match) |
| U | unlimited balls on / off (outside a match) |
| S | sound on / off |
| F11 or Alt+Enter | full screen on / off |
| any key or a click | skip an intro screen |

## Camera and sound

SETTINGS > **SHOT CAMERA**: **BALL CAM** (the default: flies behind the ball, then cuts to
the pin to watch it arrive and drop), **FOLLOW**, **TV**. Time slows only when the ball
comes by the pin. After a shot in a match the picture stays on that ball for two seconds
(longer for an epic one) before it cuts to the next player.

**S** switches all sound on or off (remembered); SETTINGS has the volume and the announcer.
Nothing loops and nothing counts down: there is no shot clock. `?sound=0` in the address
starts a browser page silent.

## Known issues

Checked against the build of 23 November 2026. "Not re-checked" means the item was reported
during the integration playthrough and nobody has looked at it again since.

Open, not fixed:

- **The installed game's window has not been tested on a second PC.** The installer, the
  installed files and the game server inside it are checked by machine; the full-screen
  window, the firewall prompt and SmartScreen are a person's job
  (`docs/dev/install-test.md`).
- **One launch monitor has been tested** (a Foresight GCQuad through the built-in bridge).
  Everything else in `docs/launch-monitors.md` is "expected to work" or less. The Uneekor
  VIEW watcher that ships with the game is inherited from Open-Birdie and has not been
  tried with this game.
- **On Sky Fortress's tee the ball sits only just above the ball dock** on a 1280 x 720
  screen (about a ball's width clear). The address camera keeps the ball above the dock's
  bar on every tee, and the armed-ball tab lifts out of the way when the ball is behind
  it; it works, but it is tight on that one tee.
- **The dock shows the loadout of the player who just hit** during the two-second hold on
  their shot in a match.
- **A match shot's level-up and new balls are silent.** In a match the level-up badge and
  the chest of new balls no longer pop up over the turn banner; the bay still earns them,
  and nothing says so until the match is over.
- **The menus' backdrop camera swings less on three stages** (Midnight Mile, Thunder Dome,
  Ice Pick): its usual swing flew through their towers, floodlights and ice spires, so it
  keeps to the clear part.
- **A ball at rest inside a big prop's footprint** (a drop beside Canyon Run's waterfall):
  the prop is drawn see-through while the ball or the camera is inside it. The better fix
  is in the hole: keep such props off ground a ball can reach.
- **The camera scrapes Skull Rock** for the first second of a straight tee shot on Lagoon
  Island (the rock is six metres left of the line and 60 m tall). Not re-checked.
- **A page reloaded mid-match** replays nothing: it comes back in play, without the intro.
- **Only four practice games.** The simulator's driving range, long drive, target challenge
  and distance ladder are left out: they plant their flags along the line from the tee,
  which on these stages is a lagoon, a canyon or a lava field.
- **Optional sound overrides are probed and answer 404** on every start (cues that have no
  file by design). Harmless, but it is noise in a browser's console.
- **Player names are not spoken** unless you supply your own ElevenLabs key: the announcer
  says PLAYER ONE / PLAYER TWO (by slot).
- **Narrow windows** (under about 1200 px wide) are not laid out: the dock scrolls.
- Not seen in any playthrough, so not judged: a lip-out (57 simulated putts with the assist
  off did not produce one), a holed approach from off the green, and the end of a sudden
  death on screen since its banner order was changed (the deciding ball's own grade banner
  is now hidden behind the CLOSEST TO THE PIN verdict; checked in code, not in a live
  sudden death).

Fixed since the playthrough of 22 and 23 November:

- A must-make putt could not be missed: a match now plays ASSISTED putting by default.
- The round "porthole" in the dock over a ball on an uphill tee is gone: the address
  camera frames the ball above the dock.
- The level-up badge and the solo chest no longer appear during a match.
- The losing ball's grade banner no longer shows behind the sudden-death result.
- A fresh install showed the midday sky on the golden-hour and morning stages: the two sky
  photos now ship with the game.
