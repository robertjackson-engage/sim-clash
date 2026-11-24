# The living world: what moves on a stage, and what answers the game

The stages were sets: beautiful, and still. This layer (marked `// v3:living` wherever it
touches a shared file) makes them inhabited. Two things, both scenery and nothing more:

- **Ambient life.** What moves through a world by itself: boats, a train, cable cars, a camel
  caravan, birds that wheel and birds that sit, fish, a dragon that watches the ball, a
  volcano that smokes, the hole's real wind in the windmill and the flags, weather.
- **Reactions.** What the world does when the players do something: a Rocket leaving the
  tee, a great shot, a ball in the cup, a ball in the water, a hole won, sudden death, the
  match. One beat at a time, on the frame its cause is on screen.

Three rules it never breaks:

1. **Nothing here changes where a ball goes.** It is drawn, and at most heard. The physics,
   the rules and the match know nothing of it (`lib/` never mentions it; a test holds that).
   What a ball can hit is the gadgets stream's (`docs/gadgets.md`).
2. **Nothing blocks or delays a swing.** No beat is waited for; everything loads behind the
   game and a model that is missing is simply not drawn.
3. **Nothing loops as audio.** A beat asks the mix for at most one one-shot.

## Files

| File | |
|---|---|
| `public/render/world-life.js` | Everything with no renderer in it: the kinds and their rules (`LIFE_KINDS`, `validateLife`), where a mover is at a time, what the graphics level and the setting leave on (`lifeBudget`), and the reaction bus (`ReactionBus`, `shotReactions`, `matchReactions`, `reactionPlan`, `beatCue`). Pure, unit-tested. |
| `public/render/world-events.js` | `WorldEvents`, on every scene as `scene.worldEvents`: builds a stage's cast, moves it each frame, plays the beats. |
| `public/render/world-models.js` | The small cast (29 low-poly models, one material; a boat, a balloon and an airship are drawn with the art stream's own GLBs when the files are there, `GLB_MOVERS`, so a boat under way is the boat that lies at the quay): train, car, cable car, groomer, camel, bird, fish, koi, dolphin, whale, turtle, crocodile, walker, windmill, windsock, pennant, snowman halves, tumbleweed ... |
| `public/render/world-fx.js` | The particles and lights: `Emitters` (smoke, mist, geysers, fireflies, butterflies), `BurstPool` (fireworks, fire, lava bombs, confetti, splashes), `Weather`, `Beams`, `ShockRing`. |
| `tools/arcade-holes/life/<stage>.js` | Each stage's life, as data. |
| `tools/arcade-holes/life.js` | The builder's side: finds a hole's life, moves it into the course, validates it. |
| `tools/arcade-art/living/plan.mjs`, `capture.mjs` | Contact sheets and frame times from a private server, headless. |
| `test/living-world.test.mjs` | 26 tests. |

## The data: `life` on a stage

A hole says what lives in it as `life: [...]`, in the hole file itself or (as all fifteen do
today) in `tools/arcade-holes/life/<hole id>.js`, so the cast can be worked on without
touching the holes. `lib.js` moves it into the course with its piece (`course.life`),
`validateCourse` checks it, `server.js` `courseGeometry()` passes it through as `geo.life`,
and `scene.loadCourse` hands it to `scene.worldEvents.setCourse(geo)`.

Coordinates are the hole's own (metres, x east, y north, the tee at the origin). A height is
`lift` (metres above the ground or the water under the point) or `z` (absolute, as a prop's
`z`). Everything is deterministic: where a thing is is a function of the scene's clock, so
both players, and every capture, see the same boat in the same place.

```js
// tools/arcade-holes/life/lighthouse-point.js
module.exports = [
  { kind: 'beam', x: -128, y: 290, lift: 23, lengthM: 280, periodS: 10 },     // the lighthouse's lamp
  { kind: 'windmill', x: 96, y: 44, heightM: 22 },                             // takes over the windmill prop there
  { kind: 'boat', path: [[-322, -90], [-292, 120], [-318, 310]], z: 0, count: 2, speed: 2.8, heightM: 9 },
  { kind: 'flock', species: 'gull', x: -236, y: 150, r: 30, lift: 30, count: 10 },
  { kind: 'perch', species: 'gull', at: [[-66, -24], [-70, 2]], lift: 3 },
  { kind: 'squall', path: [[-900, -260], [-860, 700]], z: 0, speed: 3 },
];
```

| Kind | Placed by | What it is | Its own fields |
|---|---|---|---|
| `boat`, `gondola` | `path` | A boat sailing its path (the art stream's `boat.glb` when it is there; a lantern punt). | `count`, `speed`, `heightM`, `loop` |
| `train` | `path` | Cars nose to tail, windows lit; out of sight for `gapS` between two crossings. | `count` (cars), `speed`, `gapS`, `scale`, `track: true` (draw a deck and piers under it) |
| `cars`, `traffic-light` | `path`; `at: [[x, y], ...]` | Traffic both ways on a road, white lamps ahead and red behind; lights that change. | `count`, `speed`, `laneM`, `track`; `cycleS` |
| `cable-car` | `path` (its pylons) | Pylons at the path's points, two cables, cabins up one and down the other. | `lift` (cable height), `count`, `speed` |
| `groomer`, `caravan`, `walkers` | `path` | A snow groomer; camels with riders; people on foot (or on a frozen lake: skaters). | `count`, `speed`, `loop` |
| `balloon`, `airship` | `path`; `x, y, r` | A hot-air balloon drifting; an airship circling, a sign running along its flank (it takes over the stage's airship prop). | `lift`, `speed` (negative: the other way round), `sign` |
| `flock`, `perch` | `x, y, r`; `at` | Birds wheeling; birds sitting on things. Both scatter when a ball passes or a beat frightens them, and come home. | `species` (`gull` `crow` `parrot` `crane` `bat` `swift`), `count`, `lift` |
| `fish`, `koi`, `turtle`, `croc`, `dolphins`, `whale` | `x, y, r` / `x, y` / `path` | Fish leaping somewhere in a pond; koi turning; a turtle; a crocodile that lunges at a splash; dolphins leaping along a path; a whale that blows and shows its flukes. | `count`, `everyS`, `rotDeg` |
| `fireflies`, `butterflies` | `x, y, r` | Point lights that come out when it is not day; butterflies when it is not night. | `count` |
| `dragon` | `x, y` | The stage's dragon, alive (below). | `fireEveryS` |
| `volcano` | `x, y` + `lift` / `z` | Smoke, embers, lava bombs every `everyS`; it erupts on a beat. | `scale` (a far cone is drawn big), `everyS` |
| `mist`, `geyser` | `x, y` | Mist where a waterfall lands; a geyser on its cycle (`glow: true`: a spout of lava). | `widthM`; `heightM`, `everyS`, `glow` |
| `beam`, `searchlight` | `x, y` | A lighthouse's two beams sweeping; a searchlight raking the sky (lit at dusk and night), swung to the spot by a beat. | `lift`, `lengthM`, `periodS`, `color` |
| `windmill`, `windsock`, `pennants` | `x, y`; `path` (the poles) | They answer the hole's actual wind: the mill's cap faces it and its sails turn as hard as it blows, the sock points downwind and hangs in a calm, the flags swing downwind. Pennants take the leading player's colour. | `heightM`; `colors` |
| `weather` | the stage | `type`: `snow` `ash` `sand` `mist` `petals` `rain`. One box of points that follows the camera and drifts with the hole's wind. | `amount` |
| `squall`, `shooting-stars` | `path`; the stage | A curtain of rain walking along the horizon; a streak across a night sky. | `widthM`; `everyS` |
| `signature`, `tumbleweed` | `x, y, lift`; the stage | Where a great shot's flares go up from (default: just behind the green); a flag saying a duff here rolls a tumbleweed (desert and canyon do anyway). | |

### What a hole author has to keep (`validateLife`, run by `validateCourse` and the tests)

- A known kind, a usable shape, a count from 1 to 400, a speed up to 60 m/s, one `weather`.
- **Nothing that flies below 60 m comes within 28 m of the tee-to-pin line; nothing that
  walks, sails or stands within 10 m of it.** A boat or a walker may cross the line of play
  only with `crossing: true`, and then never within 45 m of the tee or the pin.
- **A pale bird (gull, crane) never within 60 m of the line.** It is the one thing in the
  picture that could be taken for a ball. For the same reason snow never falls within five
  metres of the lens, and a shooting star stays 55 degrees or more off the hole's line.
- What stands or walks is on the stage's ground.

## What each world got

| Stage | Ambient life | Its own beats |
|---|---|---|
| **Lagoon Island** (tropical) | Two boats working the outer lagoon, dolphins off the reef, fish in the lagoon either side of the line, a turtle on the bar, gulls on the harbour posts and wheeling out to sea, parrots over the palms, butterflies by the tee, a balloon, a windsock, pennants behind the green. | A splash brings fish up round it; a bad one, and a gull on the harbour has a laugh. |
| **Canyon Run** (canyon) | Vultures turning over the gorge and sitting on the ruins, the windmill in the hole's wind, a balloon down the west rim, walkers on the rim trail, butterflies, a windsock, pennants. | A tumbleweed for a duffed one. |
| **Lighthouse Point** (links) | The light sweeps; both windmills turn with the wind; a rain squall walks along the horizon; boats beat up the coast; dolphins and a whale offshore; gulls over the cove and on the harbour; crows and walkers on the cliff path inland. | Flares go up from the lighthouse; the gulls laugh. |
| **Volcano Drop** (volcano) | The dragon on the Jaws; two cones smoking and throwing lava bombs; the lava lake spits; ash drifts; bats over the west wall; the airship circles. | The dragon roars for a great shot; a Rocket sets the cones off; a ball in the lava and it burps. |
| **Frostbite Ridge** (alpine) | Light snow, a cable car up the east face, a groomer under the ridge, skaters on the far side of the lake, choughs over the summit, the windmill in the valley, a balloon. | A ball through a snowman takes its head off; a ball on the ice throws chips. |
| **Sakura Garden** (sakura) | Koi turning in both ponds, mist where the Great Falls land, butterflies on the moss, swifts round the pagoda and on the torii, visitors strolling the west garden, the windmill, koinobori-coloured pennants by the tee; fireflies when the light goes. | Flares in front of the falls. |
| **Temple Run** (jungle) | The dragon behind the temple; three crocodiles in the rivers; mist under all four falls and wisps drifting on the floor; parrots; butterflies; fireflies in the woods (it is the golden hour); the airship. | A splash brings the nearest crocodile up snapping; the dragon roars. |
| **Pharaoh's Gate** (desert) | A camel caravan on the western dunes, sand on the wind, vultures high over the oasis, fish in it, pilgrims on the road past it, a balloon, the airship round the valley. | A tumbleweed for a duffed one. |
| **Midnight Mile** (neon) | An elevated train crossing the south end of the harbour and the boulevard 140 m out from the tee, windows lit, every half minute; cars both ways on the north flyover under traffic lights; a gondola on the canal under the bridges and a boat in the harbour; the harbour light; four searchlights; shooting stars; the airship round the stadium. | Fireworks chase a Rocket ball down its path; searchlights swing to a great shot; the airship's sign flashes the callout. |
| **Sky Fortress** (canyon) | Boats on the lake under the butte, fish rising, mist where the falls land, eagles round the keep, a balloon, the airship round the fortress, the windmill by the launch pad. | Flares from the keep; a tumbleweed. |
| **Dragon's Spine** (volcano) | The dragon on the rim; the summit cone behind it smoking, and a far one; lava spouts; ash; bats over the Ash Terrace; the airship. | A Rocket off the tee (every tee shot here) and the summit erupts; the dragon roars for a great one. |
| **Summit Express** (alpine) | The Summit Express itself: a cable car from base camp to the top; snow; a groomer on the meadow; skaters on the frozen lake; choughs; a balloon. | Snowmen lose their heads. |
| **Bullseye Bay** (arena) | The lighthouse on the horn sweeps the caldera; an airship circles the rim with the arena's name; a boat in the bay and one in the mouth; dolphins; a whale beyond; gulls and parrots. | Sudden death is played here: the dip and the flare, then flares off the water behind the island. |
| **Thunder Dome** (arena) | The airship circles the bowl, its sign running; four searchlights outside the stands; shooting stars. The crowd is the stadium stream's. | The stadium's own cannons for a holed ball; searchlights to the spot; the sign flashes the callout; the big screens show who holed it. |
| **Ice Pick** (arena) | The dragon on the west shelf; snow under the aurora; a cable car to the castle; skaters across the tarn; choughs. | The dragon roars; snowmen. |

## The big characters

**The dragon** (Dragon's Spine, Ice Pick, Volcano Drop, Temple Run). The stage's dragon is the
art stream's model (`dragon.glb`, one mesh, no skeleton). The layer draws the same file
itself, in the prop's place, so that it can move: everything above the neck (found from the
model's own vertices, `measureDragon`) is pitched and turned in the vertex shader by how far
up the neck it is (`DRAGON_NECK`, `dragonShader`). So it **turns its head to follow the
ball**, at rest and in flight (up to 60 degrees either way, eased), shifts its weight, lifts
its head and **roars a jet of fire skyward** on a beat, and breathes on a cycle of its own
(never while a ball is in the air, and never level at the ball: at least 25 degrees up).
The plain prop stands until the file is in, and stands again when the layer is off.

**The windmill** was a prop turning at a fixed rate. The layer's turns its cap into the wind
the hole really has and spins at `windmillRate(mph)` (it idles in a calm).

**A snowman** is the plain prop until a ball goes through it (`shotReactions` finds the
moment from the path). Then, behind a puff of snow, the prop gives way to a body and a head
that tips off and rolls. It stays that way for the hole.

## Reactions: the bus

```js
scene.worldEvents.react(type, { at, intensity, playerSlot, pos, text, screen })
//   type        'rocket-launch' | 'great-shot' | 'holed' | 'splash' | 'lava' | 'duff' | 'bad' | 'snowman'
//               | 'hole-won' | 'knockout' | 'sudden-death' | 'match-over'
//               and the states 'lead' (playerSlot 1 | 2 | 0) and 'scatter', which take no turn
//   at          seconds from now (0: this frame)
//   intensity   1 is normal, 2 the biggest
//   playerSlot  1 | 2: the colour the beat is played in (#ff5a36 / #2e9bff)
//   pos         { x, y } on the course: where it happened
//   text        what an airship's sign should say; screen: what the big screens should
// -> the beat that was accepted, or null: another, at least as big, holds the stage

scene.worldEvents.shotStart(shot, { playerSlot, screen })   // a shot's beats, each for its own frame
scene.worldEvents.shotProgress(t)                           // the shot's clock (scene.playShot onProgress)
scene.worldEvents.matchUpdate(match)                        // a match snapshot: its beats
```

`public/app.js` makes those three calls and nothing else (`worldShot`, the `onProgress`
line, `flushMatch`). Anything else that wants the world to answer calls `react`.

**One beat at a time.** A beat has a priority and a hold. While one holds the stage, an
equal or smaller one is dropped (never queued, never stacked); a bigger one cuts in, and
what was left of the smaller one is cancelled. This is the sound map's one-moment rule
(`docs/arcade-voice.md`) applied to the picture.

| Beat | Priority | Holds | When (on the shot's own clock, already re-timed for slow motion) |
|---|---|---|---|
| `splash`, `lava`, `duff`, `bad`, `snowman` | 1 | 1.6 to 3.2 s | as the ball hits the water (+0.12 s) / goes through the snowman; `duff` and `bad` with the banner's slam, 0.33 s after the ball stops |
| `rocket-launch`, `great-shot` | 2 | 2.4 s, 3 s | 0.1 s after impact; with the banner's slam |
| `hole-won` | 3 | 3 s | when the match says so |
| `holed`, `knockout`, `sudden-death` | 4 | 5.5 s, 3.6 s, 3.4 s | `holed`: `sim.cup.tEnd`, the end of the 0.8 s hold on the cup (the cup's own burst has the drop to itself) |
| `match-over` | 5 | 9 s | when the match is decided |

A shot has at most one beat at the stop: holed, else a great shot (an epic or good callout,
or a grade of GREAT or better; after BLAST OFF! the grade leads, as it does on the banner),
else a duff (`CHUNK CITY!`, `WORM BURNER!`), else a bad or funny one. A ball in the water
has had its beat already.

### The reaction map (`reactionPlan`; the tests hold every stage to it)

| Game event | Beat | What happens |
|---|---|---|
| A Rocket ball leaves the club | `rocket-launch` | A shock ring races out from the tee across the ground (and on through the air off a cliff edge). Every bird on the stage goes up. **Volcano stages: the cones erupt** (a fountain of lava bombs, smoke, a pulse of light). **Dragon stages with no volcano: the dragon snorts fire.** **Neon and stadium: fireworks chase the ball down its path**, each going off just after the ball has passed, 26 m and more to one side and above. |
| A great shot (callout tone epic or good; or a grade of GREAT or better) | `great-shot` | **A dragon stage: the dragon lifts its head and roars fire skyward.** A volcano stage without one: an eruption. Otherwise **flares by day, fireworks at dusk and night**, from the stage's signature piece (the lighthouse, the keep, the north stand) or from just behind the green. **The airship's sign flashes the callout text** in the player's colour; **searchlights swing to cross above the landing spot.** |
| A ball in the cup | `holed` | After the hold: fireworks behind the green in the player's colour, **confetti (the stadium stream's cannons where the stage has them, the layer's own otherwise)**, every bird up, the dragon's roar, the sign, the searchlights, and the **big screens show the player's name and score** (`PropsLayer.setScreen`, once the stadium's own IN THE HOLE! flash has had its 4.5 s). |
| A ball in the water | `splash` | **Fish leap round the spot**; where a crocodile lies within 80 m, **it lunges at it**; on an alpine stage (the water is ice) **chips of ice**. Birds near by go up. |
| A ball in the lava | `lava` | **The lava burps**: a gout of bombs and a puff of smoke from the spot. |
| A ball through a snowman | `snowman` | **Its head falls off** and rolls. |
| A duffed shot | `duff` | **A tumbleweed rolls across the hole** 12 to 26 m ahead of the ball (desert, canyon); elsewhere the laugh. |
| A bad or a funny one | `bad` | **The nearest sitting bird laughs** (it hops, a HA HA! over it; seen, not heard); a stage with no perch startles its nearest flock. |
| A hole won | `hole-won` | **Pennants take the hole winner's colour, and the balloon and the airship are washed with it**, for the beat (then they are the LEADER's again, or their own when the match is level); flares at the green. |
| A knockout | `knockout` | The colours, and the stage's biggest piece: the dragon's roar, an eruption, or fireworks. |
| The SUDDEN DEATH intro | `sudden-death` | **The lights of the whole stage dip for a second and a half, then flare** (the renderer's exposure, given back exactly; the stadium's flame jets on the flare where it has them), birds up, searchlights. |
| The match is decided | `match-over` | **The winner's colour floods the sky**: eight seconds of fireworks over the green, two volleys of confetti, the dragon, the sign, the screens. (The stadium's own win show plays as well, from `crowdReact('win')`.) |
| The lead changes hands | `lead` (a state) | Everything that flies a colour takes the leader's; level again, each its own. |

Nothing a beat sets off is ever between the camera and the ball: fireworks and flares go up
behind the green or from a piece off the line, a Rocket's fireworks go off behind the ball
and well to one side, the tumbleweed crosses ahead of the ball, searchlights cross fourteen
metres above the spot (and a beam fades to nothing toward its far end), the dragon's fire
goes up.

### Sound: the new cue names

Each beat asks for at most ONE cue, through the existing guarded `audio.cue(name, {
intensity })` (`scene.worldEvents.audio` is the game's `ArcadeAudio`; a throw is swallowed).
`cue()` ignores a name the mix does not know. All fourteen are recorded and in the mix (the
`world` category of `public/arcade/audio.js`: one beat of the world at a time, ranked as the
reactions are; `docs/arcade-voice.md` has the sources). Nobody has listened to them yet:

| Cue | Asked for by |
|---|---|
| `world-shockwave` | a Rocket launch (no volcano on the stage) |
| `world-eruption` | a Rocket launch, a great shot or a knockout on a volcano stage |
| `world-dragon-roar` | any beat in which a dragon roars |
| `world-flare` | a great shot by day |
| `world-fireworks` | a great shot at night |
| `world-celebration` | a holed ball (lands 0.8 s after `cup-drop`, so it never shares the drop's stack) |
| `world-snap` | fish or a crocodile at a splash |
| `world-lava-burp` | a ball in the lava |
| `world-tumbleweed` | a duff |
| `world-snowman` | a snowman's head coming off |
| `world-knockout` | a knockout, on a stage with no dragon or volcano |
| `world-lights-dip`, `world-lights-flare` | SUDDEN DEATH: the dip, and 1.5 s later the flare |
| `world-finale` | the match decided |

`bad` (the bird's laugh) and `hole-won` ask for nothing: the first is a sight gag, the
second has the match UI's fanfare.

## The camera's rules

The address camera's rules for what stands (`docs/arcade-feel.md` 1c) hold for what moves:

- **A mover on the line of sight to the ball, or over the first 60 m of the shot, shrinks
  out of the picture** and comes back when the way is clear (`WorldEvents._isClear`, fed the
  same `passLine()` the props layer's `setSeeThrough` gets, every frame).
- **A mover near the path a struck ball still has to fly** (the path is known at impact) gets
  out of the way the same, so nothing is ever in front of the ball cam.
- `scene.worldEvents.obstacles()` lists the ways the flyers travel as upright cylinders,
  the twin of `PropsLayer.obstacles()`; the menus' orbiting camera takes both.
- And the authoring rules above keep everything off the line in the first place.

## Budget and control

**Cost.** One `InstancedMesh` a model for the whole cast (one material, no shadows cast,
no lights added), three point clouds for every particle on a stage, a handful of matrices
written a frame. Frame times are in the table below; `scene.worldEvents.stats()` says what
is drawn.

**The graphics setting** (`lifeBudget`): **Low draws the essentials only** (the dragon, the
volcano's smoke, the lighthouse beam, windmill, windsock, pennants, cable car, airship, one
flock, thin weather: 500 points) and half the sparks; High everything; Ultra a quarter more
birds and walkers and denser weather.

**The player's setting, "World life": Full / Calm / Off** (SETTINGS in the game, the VIEW
drawer in the simulator; `?life=`; remembered). **Calm** keeps the slow and the far (boats,
the train, the dragon, koi) and takes out weather, flocks and shooting stars, and only the
hole's and the match's own beats play (holed, hole won, knockout, sudden death, match over),
gently and with no dip of the lights. **Off**: nothing is built, the props this layer had
taken over stand again as plain props, and the layer costs one `if` a frame.

**`prefers-reduced-motion`** takes out the big flashes: the dip and flare of SUDDEN DEATH,
the pulse of an eruption, and the shock ring. Fireworks, flares and the rest still play.

**The world clock** (SETTINGS > WORLD CLOCK, `?worldclock=1`; **off by default**). In a match
of three holes or more the day moves on: every hole a little later than the last, from day
through the golden hour and dusk to a floodlit night on the last (`worldClockTime`: a best of
9 plays four holes by day, two in the golden hour, two at dusk and the ninth at night; a best
of 3 day, golden, night; a tiebreak arena is always played at the last hour). It lays that time of day over the stage's own through the look
stream's override (`setLookThemeOverride(null, timeOfDay)`, set just before the stage's
scenery is built), so it costs nothing beyond the load the stage does anyway. A stage keeps
its ground, trees and props and takes that hour's sky and light: a theme at a time of day no
stage was made for has no panorama and falls back to the painted sky (`docs/arcade-look.md`,
"Not done"), which is why this is an option. Fireflies come out, searchlights light, with it.

## Frame time

The budget was about 1 ms of frame time at 1080p on the heaviest stage. Measured: **0.14 to 0.61 ms** (the heaviest: Midnight Mile), 0.42 ms on average over the fifteen stages.

How it is measured (`tools/arcade-art/living/capture.mjs --perf`): the method of
`tools/arcade-art/env/capture.mjs --perf` (frames drawn back to back and flushed by a
one-pixel read, so vsync does not round the number), but before and after are taken IN ONE
PAGE, the layer switched on and off in place (its group shown and hidden, its update run
and not run) over 14 alternating rounds of 30 frames, and the figure is the median of the
14 round-by-round differences with its quartiles. Two separate runs of the whole game on
this PC differ by a millisecond or two from one minute to the next (another game was
running on it), which is more than the thing measured; a first before-and-after taken that
way is in `.scratch/living/shots/perf-before-1920x1080.json` and says nothing useful.

The tee view (the address camera), 1920 x 1080, High graphics, RTX 4060 Ti, headless Chrome:

| Stage | Frame without | Frame with | The layer (quartiles) | "Calm" | Draw calls | Triangles | `update()` (JavaScript) |
|---|---|---|---|---|---|---|---|
| Lagoon Island | 4.46 ms | 4.91 ms | **+0.43 ms** (0.33 to 0.59) | +0.51 ms | 129 -> 140 | +1.9 k | 7 µs |
| Canyon Run | 5.00 ms | 5.34 ms | **+0.36 ms** (0.28 to 0.39) | +0.33 ms | 268 -> 292 | +3.2 k | 5 µs |
| Lighthouse Point | 4.29 ms | 4.65 ms | **+0.42 ms** (0.38 to 0.48) | +0.26 ms | 145 -> 158 | +1.9 k | 8 µs |
| Volcano Drop | 5.53 ms | 6.00 ms | **+0.50 ms** (0.23 to 0.64) | +0.31 ms | 210 -> 224 | +1.9 k | 4 µs |
| Frostbite Ridge | 4.23 ms | 4.46 ms | **+0.23 ms** (0.20 to 0.25) | +0.23 ms | 295 -> 327 | +7.0 k | 5 µs |
| Sakura Garden | 4.79 ms | 5.07 ms | **+0.29 ms** (0.26 to 0.32) | +0.29 ms | 270 -> 288 | +1.9 k | 5 µs |
| Temple Run | 5.68 ms | 6.05 ms | **+0.38 ms** (0.35 to 0.41) | +0.27 ms | 372 -> 392 | +2.6 k | 3 µs |
| Pharaoh's Gate | 6.66 ms | 7.27 ms | **+0.56 ms** (0.38 to 0.62) | +0.33 ms | 264 -> 286 | +6.7 k | 5 µs |
| Midnight Mile | 6.63 ms | 7.24 ms | **+0.61 ms** (0.27 to 0.79) | +0.44 ms | 321 -> 353 | +7.8 k | 10 µs |
| Sky Fortress | 5.73 ms | 6.12 ms | **+0.31 ms** (0.20 to 0.52) | +0.43 ms | 263 -> 293 | +3.8 k | 5 µs |
| Dragon's Spine | 5.76 ms | 6.27 ms | **+0.47 ms** (0.27 to 0.57) | +0.43 ms | 241 -> 261 | +2.1 k | 5 µs |
| Summit Express | 4.61 ms | 5.03 ms | **+0.43 ms** (0.28 to 0.52) | +0.36 ms | 146 -> 160 | +3.4 k | 5 µs |
| Bullseye Bay | 5.15 ms | 5.75 ms | **+0.57 ms** (0.48 to 0.76) | +0.54 ms | 141 -> 151 | +1.9 k | 7 µs |
| Thunder Dome | 5.34 ms | 5.48 ms | **+0.14 ms** (0.04 to 0.29) | +0.16 ms | 204 -> 209 | +1.3 k | 7 µs |
| Ice Pick | 6.60 ms | 7.66 ms | **+0.59 ms** (0.23 to 0.78) | +0.42 ms | 211 -> 235 | +5.5 k | 9 µs |

On Low graphics (its own 1516 x 853), where only the essentials are drawn:

| Stage | Frame without | Frame with | The layer (quartiles) | "Calm" | Draw calls | Triangles | `update()` (JavaScript) |
|---|---|---|---|---|---|---|---|
| Midnight Mile | 1.37 ms | 1.43 ms | **+0.07 ms** (-0.03 to 0.14) | +0.10 ms | 147 -> 153 | +0.7 k | 3 µs |
| Ice Pick | 1.36 ms | 1.48 ms | **+0.12 ms** (0.08 to 0.20) | +0.17 ms | 83 -> 94 | +2.4 k | 4 µs |
| Frostbite Ridge | 1.56 ms | 1.64 ms | **+0.15 ms** (0.03 to 0.21) | +0.14 ms | 128 -> 141 | +2.7 k | 3 µs |

A beat adds one draw while it plays (the burst pool; the shock ring for two seconds). The
draw-call column is high where a stage has boats or a balloon: the art stream's GLB is drawn
as it is, a few meshes a copy, not instanced. Not measured on a mid-range or integrated GPU.

## The hooks in shared files (all marked `// v3:living`)

| File | |
|---|---|
| `public/render/scene.js` | the import; `this.worldEvents = new WorldEvents(...)` beside the props and gadgets layers; `loadCourse`: `this.worldEvents.setCourse(geo)`; `setWind`: `this.worldEvents?.setWind(...)`; `_frame`: `this.worldEvents.update(frameTime, dt, this.camera, { line, ball, flying })` |
| `public/app.js` | two imports; the WORLD LIFE and WORLD CLOCK settings (after the shot-camera one) and `worldClock()`, called in `loadGeometry` before `scene.loadCourse`; `scene.worldEvents.audio = arcadeAudio`; `flushMatch`: `matchUpdate(m)`; `worldShot(shot)` (before the SSE block) and its call beside `scheduleCrowd(shot)`; `onProgress`: `shotProgress(t)` |
| `public/index.html` | two rows in the VIEW drawer: `seg-life`, `seg-worldclock` |
| `public/arcade/shell.js` | two rows in `_settingsRows` (WORLD LIFE, WORLD CLOCK); the backdrop orbit's obstacles take `worldEvents.obstacles()` too |
| `server.js` | `courseGeometry()`: `life: game.course.life` |
| `tools/arcade-holes/lib.js` | `require('./life.js')`; `placePiece`: `life`; `assembleCourse`: `course.life`; `validateCourse`: `lifeTools.validateLife` |

No hole file was edited (a hole's life is found by its id in `tools/arcade-holes/life/`), and
nothing in `props.js`, `prop-models.js`, `crowd.js` or `stadium-fx.js`: the layer uses the
props layer's public `ready`, `remove(id)`, `add(spec)`, `fx.fire(...)` and `setScreen(...)`.

## Looking at it

```
# a private server (never the ports the released game uses), then:
node tools/arcade-holes/build.mjs --out .scratch/living/data
node tools/arcade-art/living/plan.mjs --data .scratch/living/data --out .scratch/living/plan.json
node tools/arcade-art/living/capture.mjs --url http://localhost:8357 --plan .scratch/living/plan.json [--only <stage>-ambient]
node tools/arcade-art/living/capture.mjs --url http://localhost:8357 --perf [--stages a,b] [--gfx low]
```

`plan.mjs` writes two sheets a stage: `<stage>-ambient` (the address view, an establishing
view, then a camera on each thing that lives there, wherever it has got to:
`worldEvents.where(model)`) and `<stage>-react` (every beat, set off by hand and caught a
moment later). `capture.mjs` drives a headless browser (no window, `?sound=0`) and lays each
sheet out as one labelled JPEG.

In the page: `__birdie.scene.worldEvents.react('holed', { playerSlot: 1 })`,
`.setMode('calm')`, `.stats()`.

## Tests (`test/living-world.test.mjs`)

The kinds and that the layer can draw each; normalising and validating entries; **all
fifteen stages' life against the rules**; deterministic paths (ring, wrap, ping-pong, a
train's cars, orbits, flocks, a scatter's envelope, fish, dolphins, a whale, traffic lights);
the wind's drive; the world clock; **the tiers** (Low, Ultra, calm, off, per stage); **the
bus's one-at-a-time rule**, calm, off and reduced motion; **game events -> beats** (every
branch of `shotReactions` and `matchReactions`, with their times); **the reaction map on
every stage**, the cue names; the models and the particle pool; the layer itself built and
run for every stage in Node (a bounded cast, every beat without a throw, disposal); the
camera's rules; frightened birds; taking over and giving back props; the dragon's neck; the
hooks in the shared files.

## Not done, not verified

- **Sound.** The fourteen cues are recorded and mixed (`docs/arcade-voice.md`), chosen by
  measurement: nobody has heard them over a stage yet.
- **The grass does not ripple** under a Rocket's shock wave: the ring crosses it, the blades
  (the look stream's field) do not bend to it.
- **The stage's own banners do not change colour.** The `flag-banner` props are the props
  layer's GLBs. What takes the leading player's colour is this layer's own: the pennants, and
  a wash over the balloon and the airship.
- **Nobody walks.** Camels, walkers and skaters glide with a bob (no skeletons anywhere in
  this renderer); a crocodile is a low-poly log with eyes; the gull's laugh is a hop and a
  HA HA! over it.
- **Far traffic** is on one stage (Midnight Mile's north flyover), and small.
- **Koi, the turtle, dolphins and the whale do not react** to play; fish, crocodiles and birds do.
- **Not verified in the browser, only by the tests and by setting beats off by hand:** a
  holed ball coming through the real shot path (a real Rocket drive was captured, with its
  launch and its stop: `extra-real-rocket-drive.jpg`); the match's beats coming through a
  real match (hole won, knockout, sudden death, match over were each played by hand on
  every stage); `prefers-reduced-motion` (the flag is unit-tested); the world clock (the
  setting and the hour it picks are tested, a tournament played through it was not).
- **Not caught in a still:** the lava spouts (a fifth of a second in every eleven), the rain
  squall off Lighthouse Point (it is there, and next to a sky that already has rain in it),
  and the fireworks that chase a Rocket on Midnight Mile from the ball cam (from a far
  overview they are lost in the city's own glow).
- **Midnight Mile's train crosses the middle of the tee view** every half minute, 140 m out
  and 10 m below the tee. It is the stage's set piece and it never hides the ball or the
  landing area, but it is the one mover a player could call busy; `gapS` in
  `tools/arcade-holes/life/midnight-mile.js` spaces it out, the path moves it.
- The older white `bird-flock` props (scenery, not this layer's) used to circle close to
  the line of play on several stages (clearest at address on Canyon Run and Volcano Drop).
  They now keep this layer's rule: `validateCourse` refuses a flock with a bird within
  60 m of the tee-to-pin line (`tools/arcade-holes/lib.js`, `PALE_FLOCK_CLEAR_M`), and the
  24 flocks that broke it were moved straight out from the line.
- The frame times are one GPU's.
