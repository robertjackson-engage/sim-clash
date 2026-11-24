# The game's front end (the "shell")

Open-Birdie is a golf simulator. The game built on top of it (working name **Sim Clash**; the
name lives in one file, see "The name") is a video game with a front door: a title screen, a
main menu where you pick a game type, and nothing on screen that belongs to the simulator.
This file describes how that is done: the product switch, the menu map, solo play, the
swing gate, and how to add a mode.

Files:

| File | What it is |
| --- | --- |
| `lib/product-mode.js` | the switch (pure): the mode, which courses the game accepts, the boot stage, the swing gate |
| `lib/solo.js` | solo play (pure state machine) and the best-score store |
| `server.js` (every edit marked `v2:shell`) | wires both in: refusals, `/product.js`, `/api/shell`, `/api/solo/*` |
| `public/arcade/product.js` | the product's name as the page reads it |
| `public/arcade/shell-core.js` | the menu's state machine and lists, no DOM (unit tested) |
| `public/arcade/shell.js`, `shell.css` | the screens (classes prefixed `sc-`) and the in-game chrome |
| `test/product-mode.test.mjs`, `test/product-mode-sim.test.mjs`, `test/shell-core.test.mjs`, `test/solo.test.js`, `test/backdrop-orbit.test.mjs` | the tests |

## The product switch

One switch, on the server: `BIRDIE_PRODUCT`.

| | `simclash` (the default) | `open-birdie` |
| --- | --- | --- |
| What it is | the game | the original simulator, untouched |
| Start | title screen, main menu | straight onto the course, as before |
| Courses | its own arcade stages only | any course (OSM, cloud, HD) |
| Network | none of its own | search, downloads, scenery, cloud, skies |

`BIRDIE_PRODUCT=open-birdie` (also `sim`, `simulator`) starts the simulator; anything else, or
nothing, the game. Nothing was deleted to make the game: every simulator feature is still in
the tree and upstream changes keep merging.

The page follows the server. `index.html` loads `GET /product.js` (a classic script, first
thing in `<body>`): it sets `window.__PRODUCT__ = { mode, version, name, wordmark, ... }` and
`<html data-product="simclash|open-birdie">`, and for the game draws the boot cover (below).
`initShell()` in `app.js` returns the shell in the game and `null` in the simulator; the
constant `simClash` in `app.js` is that test.

### Tests: which product a test server is

Under Node's test runner a server that is NOT told which product it is runs as the
**simulator**. `node --test` marks every test process, and every process a test spawns, with
`NODE_TEST_CONTEXT`; `productMode()` in `lib/product-mode.js` reads it, in that one place:

    BIRDIE_PRODUCT=open-birdie | sim | simulator   -> the simulator
    BIRDIE_PRODUCT=simclash | sim-clash | game     -> the game
    not set, under `node --test`                   -> the simulator
    not set, anywhere else                         -> the game

The upstream simulator's suites start servers on real courses and expect a search or a
download to be attempted (`test/course-load-race.test.mjs` waits for one); they were written
before there was a switch, so they keep testing the simulator without any of them being
edited. The game's own tests say `BIRDIE_PRODUCT: 'simclash'` out loud
(`test/product-mode.test.mjs`). Nothing outside the test runner ever has
`NODE_TEST_CONTEXT`, so the app, `node server.js` and the dev tools are the game by default.
Run the suite with a per-test timeout, so a test that waits on something can only fail:
`node --test --test-timeout=120000 "test/*.test.js" "test/*.test.mjs"`.

On a game server the address can still ask for the simulator's screens: `?sim=1` (also
`?arcade=0` and visual capture). That changes the PAGE only: the server keeps refusing real
courses, so for real simulator play start the server with `BIRDIE_PRODUCT=open-birdie`.

### What the game's server does differently

- **Boots onto a stage.** The first tour stage that is on disk (`bootStage()`), never a real
  course, even when one is in the cache. It is the title screen's backdrop.
- **Refuses a non-arcade course.** One choke point, `acquireActivationCourse()`, which every
  activation goes through (boot, `/api/load-course`, a match stage, a solo stage): a request
  must name a cache file whose course has an `arcade` block with a theme (`courseRefusal()`).
  An OSM id, a bounding box or a name is refused before any I/O. `/api/load-course` answers
  `403 { code: 'PRODUCT_COURSE_REFUSED' }`.
- **Refuses at once, and nothing waits.** A refusal is an immediate answer: the HTTP route
  returns 403, `activationManager.activate()` resolves `{ status: 'failed', diagnostic }` in
  the same tick or the next (it never starts a fetch), a solo stage whose file turns out to be
  a real course ends the run with the reason (`solo { aborted, error }`; the page goes back to
  the menu it came from and shows it), a match stage fails through the match's own
  `stageFailed`. A data dir that holds no stage at all (one left behind by the simulator)
  still boots: no course in the bay, the server ready, the main menu saying NO STAGES
  INSTALLED. All of that is in `test/product-mode.test.mjs`, each wait bounded.
- **Does no network I/O.** No scenery enrichment (`sceneryEnricher` is `null`), no cloud
  (`BIRDIE_CLOUD_URL` and `data/cloud.json` are ignored), no sky prefetch, `/api/search`
  answers 404, `/api/courses` an empty library, Google 3D tiles are off, and `/sky/<file>`
  serves a sky that is already in `DATA_DIR/sky-cache` and 404s otherwise (the page then uses
  the bundled sky). `test/product-mode.test.mjs` runs a whole session with every TCP
  connection of the process watched and asserts that none leaves the machine.
  - The two sky photos the stages are lit by ship with the game and are copied into
    `DATA_DIR/sky-cache` on the first start (`lib/sky-bundle.js`, docs/dev/packaging.md
    "How the skies reach a player's PC"), so a fresh install has its golden-hour and
    morning skies with no network. `BIRDIE_SKY_FETCH=1` still allows the one-time download
    of any other sky from Poly Haven (CC0); nothing in the game asks for one.
  - The announcer's player-name clips (`lib/voice.js`) still call ElevenLabs when, and only
    when, the user has put their own API key in the environment. No key, no request.
- **Has no leagues.** `POST /api/leagues*` answers 404. The roster (`/api/players*`,
  `GET /api/leagues`) stays: the match lobby and the PLAYERS screen use it.

### What the game's page does not show

`shell.css` hides, under `html[data-product="simclash"]`: the course picker, the settings
drawer and its hub tiles (courses, conditions, range & games, leagues, saved shots,
scorecard), the scorecard, the leagues panel, the conditions editor, the performance check,
the round card and hole card of the top bar, the Flyover / Scorecard / Menu buttons, Practice
shot, Finish round / Next hole, Mulligan, the save-shot star, and the STAKES option of the
match lobby (matches are friendly; the engine still has stakes). The shell's key handler also
swallows the keys that open simulator panels (`W` conditions, `L` leagues, `C` free camera).

What stays, because a player needs it: the wind dial (not clickable), the shot card (to pin,
plays like, lie, club, elevation), the planner (predicted flight and the overhead map), the
club picker, the aim control, the ball dock, the arcade's coins / level / streak, the
view-from-above button, the monitor status. The last-shot numbers and the club-delivery card
are off by default and on with **D**.

## The first seconds

1. `/product.js` draws the **boot cover** before any module has loaded: the wordmark on
   black, where the title's will be, and LOADING. No HUD, no modal and no toast can flash by
   (the page starts with `html.sc-menu`, which hides the play HUD).
2. The shell lifts the cover once the stage is in and the backdrop camera has it
   (`Shell._boot()`), 12 seconds at the latest.
3. **Title**: the wordmark over the live stage, PRESS ANY KEY · CLICK · OR HIT A BALL, the
   launch monitor's status in the corner, version and FREE AND OPEN SOURCE at the bottom.
4. Any key: the **main menu** (or, on a first run with no monitor chosen, the connection
   wizard first: see "The launch-monitor wizard").

The shortest way to a match is three key presses: any key, Enter (VERSUS is the first item),
Enter (START). The lobby opens with two players ready (Player 1 and Player 2 are made on the
spot when the roster has fewer than two), a quick match and a random stage, and START has the
focus.

The backdrop camera is the scene's free camera steered from `Shell._frame()`: high behind the
hole on the tee's side, swinging slowly across the line of play, lifted clear of the ground it
flies over. (A full orbit of the green flies through the cliffs that frame it.) Props are
scenery and nothing collides with them, so the orbit is planned per stage against every
model that stands on it (`backdropOrbit()` in `shell-core.js`, fed by
`PropsLayer.obstacles()`): the usual swing where its whole sweep is clear, else the first
clear one of a short list (a narrower swing, then closer in, then higher). Twelve stages
fly the usual orbit; Midnight Mile, Thunder Dome and Ice Pick a narrower one
(`test/backdrop-orbit.test.mjs` flies all fifteen).

## The menu map

```
TITLE ── any key / click / a real swing
  └─ (first run, no monitor chosen: CONNECT wizard)
MAIN MENU                      number keys 1-7, arrows + Enter, mouse, touch
  1 VERSUS ───── the match lobby (public/arcade/match.js) ── START ── the match
  2 SOLO ─────── PLAYING AS (← → changes the player)
  │              SPRINT (3 stages) · HALF TOUR (6) · FULL TOUR (all) ── the tour
  │              SINGLE STAGE ── stage picker (12 stages + 3 arenas) ── the stage
  3 PRACTICE ─── FREE PLAY · CLOSEST TO THE PIN · PUTTING CHALLENGE · UP AND DOWN
  │              └─ stage picker (only the stages a game fits) ── the game
  4 PLAYERS ──── the roster: add, rename, remove; rank, trophies, W / L, tour best
  5 SETTINGS ─── sound, volume, announcer, shot camera, putting, straighter shots,
  │              tap-ins, graphics
  │              ├─ LAUNCH MONITOR (what the game listens for, the Foresight bridge panel,
  │              │                   SET UP MY LAUNCH MONITOR when the wizard is in the build)
  │              └─ CREDITS
  6 HOW TO PLAY ─ four pages: the game, the modes, the balls, the keys
  7 QUIT ─────── closes the window (Electron only; not shown in a browser)
```

ESC always steps back one level; from the main menu it goes to the title. In a game:

- **VERSUS**: Esc or M opens the match menu, whose last item reads EXIT TO MAIN MENU
  (`menuItems(m, game, { shell: true })`). When a match ends or is left, the main menu is back.
- **SOLO / PRACTICE**: the MENU button in the header, or Esc, opens the pause menu: RESUME,
  RESTART STAGE (not in a tour) or RESTART TOUR, GIVE UP THIS STAGE (scored runs), SETTINGS,
  EXIT TO MAIN MENU. Destructive items ask once (press again).

Sound: one guarded cue per action (`ui-tick` a move, `ui-confirm` a pick, `ui-back` a step
back, `whoosh` leaving the title and a stage card, `lobby-open` the results). Nothing loops.

### Deep links

| Address | Opens |
| --- | --- |
| `?match=1` | the match lobby (ESC still steps back to the main menu) |
| `?menu=main` | the main menu, no title |
| `?menu=0` | straight onto the loaded stage in free play: no title, no menu. **Use this for tools, screenshots and QA that post test shots**: with a page on the title, swings are dropped |
| `?connect=1` | the launch-monitor wizard (when its module is in the build) |
| `?sim=1` | the simulator's screens |

A page that loads while a match or a solo run is in play joins it, whatever the address says.

## The swing gate ("the front end is in its menus")

A launch monitor sends a ball whenever one is hit. A swing while the title or a menu is up
must not be played, counted or charged.

- The page tells the server which kind of screen it is on: `POST /api/shell { cid, screen:
  'menu' | 'game' }`. `cid` is the page's id, which the server hands out as the first event of
  the stream (`hello { cid, product, shell }`).
- While the page that spoke last is in the menus, `playShot()` drops the swing (no shot, no
  stroke, no arcade grade, no ball spent, nothing in the bag) and broadcasts
  **`shell-swing { speedMph }`** instead. On the title that event is "press any key".
- The gate belongs to that page: when its event stream closes, the gate opens. A headless
  server, a test or a tool that never names a screen is never gated.
- Every screen is "menu" except play itself, the pause menu and a result card
  (`machine.inMenu`, tested screen by screen).

**For another module that needs swings held** (the connection wizard's "hit a ball" check):

```js
window.__simclash.setSwingHold(true);    // every swing is dropped and reported as 'shell-swing'
events.addEventListener('shell-swing', (e) => { const { speedMph } = JSON.parse(e.data); /* the ball arrived */ });
window.__simclash.setSwingHold(false);   // the screen decides again
```

A wizard mounted by the shell (the `connect` screen) needs no hold: that screen is a menu
screen, so the gate is already shut while it is up.

Solo has its own, second gate on the server: a run only takes a swing in its `play` phase
(not while a stage loads, not over a result card), the same rule the match has.

## Solo

Built on what was there: the bay's solo arcade play on a one-hole stage course, the tour
manifest (`data/arcade-tour.json`), and the course activation a match stage uses. The engine
addition is `lib/solo.js`, a pure state machine in the shape of `lib/match.js`: it never
touches the game, the disk or a timer, asks for a stage's course through `waiting`, and is fed
every shot the game played.

- **Kinds**: `tour` (the tour's first N stages in order, for a total against par), `stage`
  (any tour stage or tiebreak arena, for a score), `free` (one stage, nothing kept: hole out
  and it tees up again; PRACTICE uses it).
- **Phases**: `loading` → `play` → `stage-result` → (`next`) `loading` ... → `done`.
- **Scoring**: strokes are the game's own (`result.strokes`); points and coins are the arcade
  grade's. Everything the arcade gives stays on: callouts, coins, balls, streaks, challenges,
  the rolled wind, the free rocket on a rocket hole.
- **A stage always ends**: holed; or picked up automatically at par + 6 strokes (it then
  counts one more); or GIVE UP THIS STAGE, which costs the strokes so far plus one and never
  less than par + 4.
- **No mulligans** in a scored run (`/api/mulligan` answers 409), and `/api/next-hole` is
  refused while a run is active (the run's own routes move it on).
- **A drop on the line counts.** `POST /api/drop` is the game's own `dropOnLine()`: it adds
  the drop's stroke to the game's count (nothing for a free drop out of a dead lie), and the
  run takes its strokes from the game, so the stroke is on the stage's score with the next
  swing. The route answers 409 while a run is not in its `play` phase.
  (`test/arcade-playability.test.js`, "a scored solo run counts the stroke of a drop".)
- **Results**: the stage card (score name, strokes, points, tour total, what is next); at the
  end the results card (to par, strokes against par per stage, points, the three best shots:
  epic callouts first, then the best-paid good ones, and NEW BEST SCORE).
- **Best scores**: `DATA_DIR/solo-best.json`, per player (a guest is `_guest`), per tour
  length and per stage: `{ version: 2, tours: { "3": { <playerId>: { strokes, toPar, points,
  at, name, stages } } }, stages: { <stageId>: { <playerId>: {...} } } }`. Fewer strokes wins;
  level on strokes, more points. A removed player's scores go with them.

Routes (every change broadcasts `solo` with the run, `null` when there is none):

```
GET  /api/solo                 { run, bests, stages, arenas }
POST /api/solo/start           { kind: tour|stage|free, stage?: id, length?: n, playerId? }
POST /api/solo/next            leave a stage's card (free: the same stage again)
POST /api/solo/restart-stage   back on the tee (not in a tour)
POST /api/solo/give-up         pick the stage up
POST /api/solo/abort           end the run (also dismisses a finished one)
```

A match start ends a solo run; a solo start is refused while a match is in play.

### Practice

FREE PLAY is a `free` run. The three games are the simulator's own practice sessions
(`lib/practice.js`, `POST /api/practice`) started on top of a `free` run on the chosen stage:
closest to the pin (par 3 stages and arenas up to 240 yards), the putting challenge and up
and down (any stage). The other four (driving range, long drive, target challenge, distance
ladder) are left out: they plant their flags along the hole's line from the tee, which on
these stages is a lagoon, a canyon or a lava field. That choice was made from where the flags
land, not from playing all four on every stage.

## The test swing

How people try the game without a launch monitor. Bottom right, in place of the simulator's
Practice shot button: **TEST SWING** plays the SMART SWING (the shot the lineup predicts for
the club the game picked, a touch off), the arrow beside it (or **T**) opens the presets:
SMART SWING, DRIVE, IRON, WEDGE, CHIP, PUTT (keys 1 to 6 while the list is open) and
SLIDERS (the simulator's practice-shot panel). It is on screen while no monitor is connected,
and behind **T** when one is.

## The launch-monitor wizard and the Foresight panel

Both are other streams' modules, mounted by the shell when they are in the build:

- `public/arcade/foresight-panel.js`: mounted in SETTINGS > LAUNCH MONITOR into
  `[data-sc-mount="foresight"]` (`mountForesightPanel(el, { fetchJson, events })`).
- `public/arcade/connect.js`: `new ConnectWizard({ root, fetchJson, audio, events, onDone })`
  into `[data-sc-mount="connect"]` on the `connect` screen. It opens on the way out of the
  title when the module exists, no monitor is connected, `GET /api/connect/status` says none
  has been chosen, and it has not been done or skipped before (`sim-clash.connect.done`);
  SETTINGS > LAUNCH MONITOR > SET UP MY LAUNCH MONITOR runs it again. SKIP FOR NOW is the
  shell's own button, so the screen is never a dead end. "None has been chosen" is the
  status's `chosen: false` (`lib/connect.js` remembers the choice in the data dir). The
  wizard holds swings itself while HIT A BALL is up (`POST /api/connect/probe`); the shell's
  gate is shut on that screen as well.

The monitor status reads `LAUNCH MONITOR CONNECTED · <SOURCE>` when the server's `lm` event
carries `source`.

## The name

`public/product.json` (the release stream's; `lib/product.js` reads it) is the one place the
name lives. The server puts it into `/product.js`; `public/arcade/product.js` gives it a
shape (`PRODUCT.name`, `PRODUCT.words`, `PRODUCT.tagline`, `PRODUCT.colors`,
`PRODUCT.builtOn`). The title's wordmark is live text built from `wordmark`, one half per
player colour, so a rename is one line and nothing is redrawn. The credit to Open-Birdie
stays in SETTINGS > CREDITS, whatever the game is called.

## How to add a mode

1. **The menu.** Add an item to `MAIN_ITEMS` in `shell-core.js` (`{ id, label, sub, to,
   tone }`) and, if it has screens of its own, a screen to `SCREENS` with its `parent` (where
   ESC goes) and `list: true` or `grid: true` if it has a cursor.
2. **The screen.** In `shell.js`: what the cursor walks (`_items()`), what it looks like (a
   method returning HTML, registered in `_render()`), what a pick does (`_select()`).
3. **The game.** If it is a way of playing the stages alone, add a kind to `lib/solo.js`
   (what ends a stage, what `next()` does, what is kept) and start it with
   `/api/solo/start`. If it needs two players, it is a match format (`lib/match.js`). A game
   on the stage in play that needs no score keeping can be a practice session
   (`lib/practice.js`) on a `free` run.
4. **In play.** `Shell.mode` says which header shows; `_renderHdr()` draws it; the pause menu
   is `_pauseItems()`; a finished game shows a card from `_renderOverlay()`.
5. **The gate.** Nothing to do: any new menu screen is "in the menus" by default. Only add a
   screen to the exceptions in `machine.inMenu` if a swing must count while it is up.
6. **Tests.** The machine (`test/shell-core.test.mjs`: the gate table lists every screen and
   fails until the new one is in it), the engine (`test/solo.test.js`), the server
   (`test/product-mode.test.mjs`).
