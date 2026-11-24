# Arcade HUD — how it is wired, what it shows, what it plays

Files (all under `public/arcade/`):

| File | What |
| --- | --- |
| `arcade.js` | `ArcadeUI` — the HUD, FX and the shot's sound script (ES module, no deps) |
| `arcade.css` | all styles, prefixed `.arc-` / `#arcade` / `#arcade-cine` |
| `audio.js` | `ArcadeAudio` — cues, crowd one-shots, the announcer (the voice stream's file) |
| `demo.html` | standalone test page: `/arcade/demo.html?sound=0` |

Tests for the pure parts: `test/arcade-hud.test.mjs`.

## Wiring (`public/app.js`, already in place)

```js
const arcade = new ArcadeUI({ hud: $('hud'), audio: arcadeAudio, fetchJson });
es.addEventListener('state', ...)         // arcade.setGameState(s)          the pin, for the crowd script
es.addEventListener('shot', ...)          // arcade.onShot(shot, state)      right before scene.playShot
es.addEventListener('arcade', ...)        // arcade.onArcade(ev)             the grade and its callout
es.addEventListener('arcade-state', ...)  // arcade.onState(snapshot)
function flushMatch() { ...; arcade?.setMatch(m); }   // v2:arcade-hud: with matchUI.onMatch(m)
```

## Public API (`ArcadeUI`)

```js
new ArcadeUI({ hud, audio, fetchJson })   // builds <div id="arcade"> (+ #arcade-cine) in hud, GETs /api/arcade
arcade.onShot(shot, state, opts?)          // at impact; returns the sound script. opts: { timeScale } | { wallMs(t) }
arcade.onArcade(ev)                        // the grade; its callout lands when the outcome is on screen
arcade.onState(snapshot)                   // coins / xp / level / streak / inventory / armed / powerups / challenges
arcade.setMatch(state | null)              // the match state: the dock becomes the loadout of whoever is up
arcade.setGameState(state)                 // keeps state.pin ([x,y] m, or {x,y}) and distToPinYd
arcade.arm(id)                             // solo: POST /api/arcade/arm; in a match: POST /api/match/arm { playerId, id }
arcade.toggleTray(force?)                  // every ball and what it does (key B). toggleHelp() is the same thing
arcade.setMuted(bool)                      // the ⚡ in the tray; localStorage 'open-birdie.arcade.muted'
arcade.dispose()
```

Exported, pure, for tests: `buildCrowdScript`, `wallMsFor`, `calloutOf`, `calloutMoment`,
`crowdCueFor`, `splitCallout`, `heatOf`, `ballName`, `dockModel`, `challengeDiff`, `recordOf`.

## Where things are (1680×945 design frame, under `#hud`'s zoom)

| Zone | Element | Notes |
| --- | --- | --- |
| top band, centre | `.arc-top`: coins · level + XP · combo meter | solo only: a match header owns this band (`arc-in-match`, and `:has(.mt-header)`) |
| upper centre, `top: 178px` | `.arc-stage`: callout banner, then grade · points · multiplier · coins, then why | under the line the app's toasts use; the widest text is fitted to 780 px with the planner open, 1000 without |
| upper centre | `.arc-flash` (armed, ball name), `.arc-curse` (a trick waiting, `top: 252px`), `.arc-slowmo-tag` | the planner open shifts all of these 40 px left |
| beside the planner, `top: 162px` | `.arc-chal`: challenges | a small tab; opens for a few seconds when there is news, or when tapped |
| bottom centre, `bottom: 92px` | `.arc-dock`: the ball hotbar; `.arc-tray` opens upward | at most 850 wide so it clears the planner |
| left of the dock | `.arc-chest` | new balls |
| under every HUD panel | `#arcade-cine`: slow-motion letterbox, ON FIRE glow and embers, the fog veil | first child of `#hud` |

The dock, the challenges and the curse warning step aside while a ball is in the air
(`arc-flying`), and the challenges also while a banner is up (`arc-revealing`) or a flash
(`arc-flashing`). `body.stage-open` (a panel over the course) hides the dock.

Other classes this file sets outside its own root: `arc-fog` on `#hud`, and `arc-quake` /
`arc-thud` on `<body>` for 0.6 s (arcade.css jolts `#scene` with a transform; off under
`prefers-reduced-motion`).

## The callout banner

`ev.callout = { id, text, tone, voice }` leads; without one the grade's label does, as before
(`JACKPOT` epic, `PERFECT` / `GREAT` good, `GOOD` / `OK` neutral, `MISS` / `DISASTER` bad).

| Tone | Look |
| --- | --- |
| `epic` | gold, rays, letters rippling, sparks and confetti, the picture shakes |
| `good` | white on green (gold for PERFECT), a hard slam and a shock ring |
| `neutral` | white, a pop and an underline |
| `bad` | red, drops from above, lands in dust and breaks in two |
| `funny` | Impact letters in five candy colours on a wobbling blob, tilted, each letter jiggling, a comic sunburst and two stickers per callout id (`STICKERS` in arcade.js) |

**When it lands** (`calloutMoment`): never before the ball gets there.

| Callout | Moment |
| --- | --- |
| `hole-in-one` `holed-out` `chip-in` `drained` `in-the-hole` | the `holed` event (as it drops) |
| `splash` `lava` | the first `water` event |
| `timber` | the `tree` event, if the ball stops within 3.5 s of it, else the stop |
| `robbed` | 0.2 s after the closest pass of the cup, if within 3.5 s of the stop, else the stop |
| `blast-off` | 0.35 s after impact; gone again in 1.7 s, and the grade leads at the stop |
| everything else | the last path point: the ball has stopped |

Events without their own `t` take the time of the nearest path point. What the shot earned
(points, coins, reasons) always waits for the stop. The scene's `onDone` fires up to 0.9 s
later than the stop; this file does not wait for it.

## The dock

- **Solo**: the balls the bay owns (count each, `∞` under `unlimited`), up to nine on the bar.
  Tricks are never offered (they are greyed in the tray as "match play only").
- **Match** (`phase` `play` or `tiebreak`, a `currentPlayerId`, power-ups not `off`): the
  loadout of whoever is up, in their colour (slot 1 `#ff5a36`, slot 2 `#2e9bff`): up to six
  unused balls, the tray button, and the three tricks as the SABOTAGE group aimed at the
  opponent by name. `charges: null` is unlimited. A trick is locked once the opponent carries
  a curse. On a stage with `freeBall`, a player with `strokes: 0` sees `FREE <BALL>` and cannot
  arm another ball for that shot (a trick still can be cast). Any other phase: no dock.
- **Keys**: `1`–`9` the bar left to right, `Shift+1`–`9` the next nine that can be armed,
  `B` (or `?`) the tray, then arrows + `Enter`, `Esc` / `B` closes. The listener is on
  `window` in the capture phase, and with the tray open it consumes the arrows and Enter so
  the aim does not move. Nothing can be armed while a ball is in the air.
- A trick waiting on the player who is up (`cursedWith`) shows as a warning chip; `fog` also
  puts `arc-fog` on `#hud`, which hides `#lie-pin #sc-plays #sc-fb #sc-why #hud-len #mm-topin
  #pl-band #pl-fb #pl-carry #pl-total #cc-carry #sd-carry #sd-total #sd-vs .fv-stat`, covers
  `#pl-map` and `#flightview`, hides `.dist-marker` in the 3D view and `.mt-num-d b` in the
  match header. Anything else opts in with a `data-yardage` attribute.

## Sound: which event plays what

One moment, one stack: at most one impact, one crowd reaction, one sting and one voice
line, placed on the frame where the thing visibly lands, never repeated on a clock.
`_moment()` hands `{ impact, sting, crowd, say, intensity, priority }` to `audio.moment()`
when the engine has it; otherwise the impact and the sting play at once, the crowd 150 ms
later and the voice 250 ms after that. Every call is optional-chained and try/caught.

| When (the frame) | Cue |
| --- | --- |
| impact (`onShot`) | `strike` (intensity from ball speed), or `rocket` instead when the ball is the Rocket |
| each landing of the first three bounces | `green-thump` / `sand-thud` / `ice-skid` / `fairway-bounce` by the bounce's `surface` |
| a `tree` event | `tree-knock` (the crowd's `gasp` 50 ms before) |
| a `water` event | `splash`, or `lava-sizzle` when the callout is `lava` (a `gasp` 0.35 s before) |
| a `holed` event | `cup-drop`, and the script's `roar` |
| apex of a 265 yd+ carry; the ball closing inside 15 yd | `oooh` (once each) |
| a lip-out with no callout for it | `gasp` |
| **the banner's slam** (275–350 ms after it appears) | one `audio.moment`: sting = the grade's cue (`jackpot` `perfect` `great` `good` `miss` `disaster`; `ok` only with a callout), crowd = `crowd-roar` (epic) / `crowd-cheer` or `applause` (good) / `crowd-ohh` (`robbed`, `so-close`) / `crowd-aww` (bad) / `crowd-laugh` (funny), say = `callout.voice` at priority 2 |
| `blast-off` at launch | the announcer only (`say`), no sting, no crowd |
| a grade of OK with no callout | nothing: silence is contrast |
| coins bursting out of the points row (solo) | `coin-burst` |
| the combo number punching out (streak up, 2 or more) | `streak-up` |
| the combo meter breaking (from 2+ to 0) | `streak-break` |
| a record line slamming in | say `m-new-record` |
| LEVEL UP!'s slam | `levelup` |
| the chest's lid flying open | `chest-open`; each further ball popping out: `trophy-tick` |
| COMPLETE! stamping a challenge | `confetti-pop` |
| a ball armed (the token lights) | `arm-common` / `arm-rare` / `arm-epic` (legendary uses epic), then say `pu-<id>` |
| a trick cast | `trick-cast`, then say `pu-<id>` (the match screens draw SABOTAGE!) |
| a ball put back; the tray or the challenges closed by the player | `ui-back` |
| the tray or the challenges opened by the player | `ui-confirm` |
| the pointer entering another dock slot; the tray's cursor moving | `ui-tick` |

The crowd never doubles up: a crowd one-shot is dropped within 1.1 s of another, and the
script's own `gasp` / `oooh` / `roar` give way from 1 s before to 1.5 s after the moment a
callout's crowd reaction is due (so a holed ball gets one roar, with the banner).
`audio.crowd(level, ramp)` (the continuous bed) is still called; the engine ignores it
unless ambience is enabled.

## Things worth knowing

- **Solo rocket holes.** `arcade.setFreeBall(id | null)` (app.js calls it from
  `syncBallSkin`: the course geometry's `arcade.freeBall` while the hole's first stroke is
  to come): the dock leads with FREE <BALL>, the other balls are locked for that shot and
  the bay's armed ball shows as KEPT. `dockModel(snap, catalogue, match, { freeBall })`.
- **The ball and the dock.** `new ArcadeUI({ ..., ballScreen })`: `ballScreen()` gives the
  ball's place on screen (client px). Three times a second: if the ball is under the armed
  tab the tab lifts clear (`arc-lift`). The address camera frames the ball above the dock's
  BAR on every tee (`public/render/see-over.js`, `safeBottom`), so the round porthole the bar
  used to get on an uphill tee is gone; the tab, which stands on the bar's middle, still needs
  the lift.
- **Keys under a match overlay.** While the match menu, the stray-ball prompt or a
  full-bleed match screen is up, the dock's keys do nothing (this listener runs before the
  match UI's, and "2: UNDO LAST SHOT" used to arm ball 2 as well).
- **Unlimited** means never runs out, not stays armed: the snapshot's `armed` is null again
  after every shot.

- **Counters wait for the reveal.** Between `onShot` and the coins landing, `onState` updates
  the dock but not the coin / XP / streak numbers; the challenges wait until the banner has
  cleared. A shot that never gets an `arcade` event releases them 2.5 s after it stops.
- **Challenges** are read from `snapshot.challenges` (nothing is shown without the field).
  `award.challenges` (finished by this shot, already replaced in the snapshot) keep their row
  for two seconds, gold and stamped COMPLETE!, before the new one slides in.
- **A record** is shown only if the grade carries one: `ev.record` (or `ev.records[0]`,
  `ev.award.record`) as `{ label | text | id, value }`. The server sends none today.
- **Colours** arrive as numbers (`0xff5a1f`, the trail's) or `'#rrggbb'`; both work.
- **Muted (⚡)**: no banners, particles, slow-mo, crowd or cues; the dock stays so a ball can
  still be armed; the counters still settle.
- **Particles** are DOM nodes, capped at 140 live. `prefers-reduced-motion` shortens every
  animation, drops confetti, sparks, rays and the jolt, and runs the reveal at 0.45×.
- `node --check public/arcade/arcade.js` fails here (the root `package.json` is CommonJS);
  use `node --input-type=module --check < public/arcade/arcade.js`.

## The demo page

`/arcade/demo.html?sound=0` fakes `/api/arcade*` and `/api/match/arm` in memory and logs
every cue, every announcer line and the planned sound script.

- Shots with a ball: bomb, hole-out, water, lip-out, tree, rocket, slice, worm burner.
- Every callout id as a banner; grades with no callout; own all / none / unlimited / an old
  seven-ball server; a match (either player up, gust, fog, tiny cup, spent, hole result,
  unlimited, a rocket hole); streak up and break, chest, level up, record, challenges.
- Deep links after `#`: `shot=` `callout=` `grade=` `extra=level|chest|record|chal|chaldone`
  `match=p1,gust` `arm=` `tray=1` `all=1` `unlimited=1` `streak=4` `planner=1` `clean=1`
  (hides the demo's own panels) `moment=1` (an engine with `audio.moment`) `warp=0` `late=1` `old=1`.
