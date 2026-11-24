# Course gadgets

Interactive pieces on the arcade stages that a real swing can hit: rings that boost a ball,
pads that throw it back into the air, strips that run it on, a wind tunnel, geysers,
bumpers, rails, backboards, funnels, ice, mud, a warp pipe, a cannon, breakable walls,
coin trails and multiplier rings. Each has real physics, a look, a sound cue and a payoff.

| Piece | Where |
| --- | --- |
| The kinds, the data, the physics field, coins / points / callouts | `lib/gadgets.js` |
| The hooks in the step loop | `lib/physics.js` (`simulateShot`, `opts.gadgets`) |
| The game: the field, `result.gadgets`, Rocket and Ghost | `lib/game.js` |
| The economy: coins, points, the multiplier, the callout | `lib/arcade.js` (`gradeShot`) |
| The lineup | `lib/predict.js` (`gadgets: { hits, ahead }`) |
| The dead-lie guard | `lib/playability.js` (`ctx.gadgets`) |
| Authoring, validation | `tools/arcade-holes/gadgets.js` (called from `lib.js`), `preview.mjs` |
| Rendering, reactions, cameras | `public/render/gadgets.js`, `public/render/gadget-core.js` |
| Tests | `test/gadgets.test.js`, `test/gadgets-render.test.mjs` |

## The rules every gadget keeps

1. **Deterministic.** The whole shot is simulated on the server at impact. Nothing in a
   gadget is random and nothing depends on wall time: the same swing meets the same gadgets
   with the same result, for both players and on every client. A geyser's cycle is counted
   from the shot's own time zero.
2. **Stateless between shots.** A wall that was smashed and a coin that was taken stand
   again for the next swing. Both players of a match face the same course; an undo, a
   mulligan or a restarted hole has nothing to put back.
3. **A putt is never touched.** The putting assist solves the putt it then plays; a funnel
   on a green, a strip, mud, a pad: none of them acts on a putt.
4. **Every contact is in the shot's event list** with its time, so the client animates and
   sounds it in sync: `{ type: 'gadget', id, kind, t, x, y, z, effect, ... }` in
   `sim.events`, and the same contacts (without `type`) as `result.gadgets`.
5. **No ball is trapped by one.** A solid within 12 m of where the ball is struck is air for
   that shot; mud stops a ball but the next swing from it is an ordinary one.
6. **Off is off.** A course with no `gadgets` passes nothing to the physics and the shot is
   the shot it was, to the last bit (no `gadgets` key on the result either).
7. **Practice is the stage.** Every way of playing a stage meets its gadgets the same way:
   a match, a solo run, PRACTICE > FREE PLAY (the game's ordinary shot), and the practice
   games (`lib/practice.js`, which gets the same field through `Game.startPractice`):
   CLOSEST TO THE PIN flies through the lantern and the coin trail and is drawn in by the
   funnel at the flag, UP AND DOWN chips into that funnel and off the bumpers behind the
   green. The contacts are on the result (`result.gadgets`, the `gadget` events) and are
   paid like a match ball's; the lineup of a practice ball flies through them too. The
   PUTTING CHALLENGE is untouched because every putt is (rule 3). Nothing is hidden in
   practice: what is drawn is live.

## The kinds

Coordinates are the course's: x east, y north, z up (metres, the elevation grid's datum). A
`heading` is a compass bearing in degrees (0 north, 90 east), as an aim is. `default` is
what a hole gets when it leaves a number out; the range is what `normalizeGadgets` accepts.

| `kind` | What it is | Its numbers (default; range) | What it does, measured | Event `effect` | Pays |
| --- | --- | --- | --- | --- | --- |
| `ring` | A hoop in the air, across the flight (`z`, `heading`: the way the flight goes) | `radius` 8 (3 to 20), `strength` 1.25 (1.05 to 1.6) | A ball through it flies on `strength` times as fast. A 150 mph drive (12 deg, 2600 rpm) through a x1.25 ring 100 m out, where it is doing 90.2 mph: 112.7 mph, carry 244.4 -> **293.5 yd**, total 265.3 -> 316.2. Miss it (outside its radius) and nothing happens. Once a shot | `boost` `{ gain, mphIn, mphOut }` | 25 coins, 50 points |
| `pad` | A pad on the ground | `radius` 5 (2 to 12), `angle` 50 (20 to 80), `strength` 1 (0.5 to 1.6), `minMps` 16, `maxMps` 45, `heading` (optional) | A ball landing or rolling on it is thrown at `angle`, at its own speed x `strength` held between `minMps` and `maxMps`, the way it was going (or along `heading`). The drive lands on one at 63.7 mph and leaves at 28.5 m/s: total 265 -> 329 yd. Once a shot. Its spin is re-aligned with the new heading | `launch` `{ speedMps, mphIn, mphOut }` | 10 coins |
| `strip` | A strip of ground with an arrow | `size` [width, length], `heading`, `strength` 7 m/s2 (2 to 15), `maxMps` 24 (3 to 40) | A ROLLING ball inside it is accelerated along the strip's heading until it does `maxMps` that way. A drive that rolls through a 40 m strip: total 265 -> 361 yd. A ball flying or bouncing over it is untouched | `speed` | 10 coins |
| `fan` | A box of moving air (`z`: its floor, default the ground) | `size` [width, length, height], `heading`, `strength` 14 m/s2 (0 to 30) along the heading, `lift` 0 (0 to 40) upward | Pushes the ball while it is inside. 14 m/s2 across the line over 60 m of the drive: 57 yd off line. 8 m/s2 of lift over the same 60 m: carry 244 -> 284 yd. A ball over its top is untouched | `push` (on entering) | |
| `geyser` | A vent that erupts on a cycle | `radius` 5 (2 to 12), `height` 40 (10 to 80), `strength` 24 m/s (10 to 40), `cycle` 4 s, `offset` 2 s, `burst` 1.5 s | Firing from `offset + k x cycle` for `burst` seconds, counted from impact. A ball inside its column (within `radius`, no higher than `height`) while it fires is thrown up at `strength` and keeps 60 % of its speed over the ground. Once a shot | `erupt` | 15 coins |
| `bumper` | A pinball post | `radius` 1.6 (0.8 to 4), `height` 3.5, `strength` 16 m/s (4 to 28) | The ball comes off it like a pinball, at `strength` or its own speed if that is more (34 m/s at most), never along the post | `bump` `{ speedMps }` | 5 coins |
| `rail` | A low wall along a line (`points`) | `radius` 0.7, `height` 1.6, `strength` 12 m/s (4 to 24) | As a bumper, all along it | `bump` | 5 coins |
| `backboard` | A wall that kills pace | `size` [width, height], `heading` (the way it faces), `strength` 0.3 (restitution, 0.05 to 0.8) | A ball that meets it keeps `strength` of its speed into the wall (turned round) and 70 % along it: it drops at the board's foot | `board` | |
| `funnel` | A bowl in the ground | `radius` 9 (4 to 20), `strength` 1.2 m/s2 (0.3 to 3) | A rolling ball inside it is drawn to its middle (the pull fades inside 2 m, so the ball rests there). A pitch that stopped 7 m from the middle finishes under 2 m from it | `funnel` (on entering) | |
| `ice` | A patch of ice (`radius`, or `size` + `heading`) | `friction` 0.3 m/s2 (0.1 to 1) | Rolls at `friction` (fairway: 2), bounces keep 85 % of their speed and no spin bites. The drive that lands on it: total 265 -> 326 yd | `slide` | |
| `mud` | Sticky mud (`radius`, or `size` + `heading`) | | A ball that lands in it stops where it lands (total = carry); one that rolls in stops inside a metre | `stuck` | |
| `warp` + `warp-exit` | The mouth of a pipe or a cannon (`style`), and where it fires from | mouth: `radius` 3 (1.5 to 8), `delay` 0.7 s, `pair` (its exit's id), `z` (in the air) or none (on the ground). exit: `heading`, `angle` 45, `speedMph` 90 (10 to 220) | A ball entering the mouth is gone for `delay`, then leaves the exit at its speed, heading and angle with 3000 rpm of backspin. The carry ends at the mouth. Once a shot | `in` `{ to }`, then the exit's `out` `{ from, speedMph }` at `t + delay` | 20 coins, 50 points |
| `breakable` | A wall (`size` [width, height] + `heading`, `z`: its foot when it hangs in the air) or a round thing (`radius`, `height`, `z`); `style` `wall`, `crate`, `ice-wall`, `snowman`, `pinata` | `breakMph` 120 (30 to 220), `keep` 0.85 (0.5 to 1) | A ball LAUNCHED at `breakMph` or more (the number on the launch monitor) goes through and keeps `keep` of its speed; a slower one comes back off it (45 % of its speed into the wall). **149 mph bounces off the 150 wall, 150 and 151 break it.** A ball trickling into one (under 4 m/s) never breaks it | `smash` or `bounce`, `{ needMph, style }` | 50 coins, 100 points (a smash) |
| `coins` | Coins hung in the air (`points` [[x, y, z], ...]) | `reach` 5 m (2 to 10) | Each coin the ball passes within `reach` of is collected. They never touch the ball | `coin` `{ index }` each; `full` `{ count }` for the set | 5 coins each; the set: 50 coins, 150 points |
| `zone` | A landing ring on the ground | `radius` 10 (4 to 25), `mult` 2 or 3 | The ball's FIRST landing inside it multiplies that shot's points | `x2` / `x3` `{ mult }` | the multiplier |

Power-up balls: a **Ghost** passes through every solid (bumper, rail, backboard,
breakable) with no contact; it still goes through rings, fans and the rest. A **Rocket**
smashes any breakable at any speed and loses nothing to it. A Titan or a Fireball is judged
on the speed it was launched at (their boost counts).

A solid contact turns the ball: its spin is re-aligned with the new heading and mostly
taken off (a kick or a wall keeps 30 %, a geyser 50 %, a pad 60 %). After eight solid
contacts in one shot the solids are air (no endless pinball).

## The data

A hole file lists its gadgets in `gadgets: [...]`; the built course carries them as
`course.gadgets` (and `GET /api/course-geometry` as `gadgets`), tidied by
`normalizeGadgets`: numbers to a centimetre, defaults filled in, nothing a kind does not use.

```js
{ id: 'mesa-ring', kind: 'ring', x: 41.53, y: 112.72, z: 52.9, heading: 20.22, radius: 8, strength: 1.36, reward: { coins: 25, points: 50 } }
{ id: 'barricade', kind: 'breakable', x: 15.55, y: 42.23, z: 33, heading: 200.22, size: [16, 14], breakMph: 150, keep: 1, style: 'wall', reward: { coins: 50, points: 100 } }
{ id: 'great-bombard', kind: 'warp', x: 0, y: 184, radius: 8, delay: 0.9, style: 'cannon', pair: 'bombard-muzzle', reward: { coins: 20, points: 50 } }
{ id: 'bombard-muzzle', kind: 'warp-exit', x: 0, y: 186, z: 49, heading: 0, angle: 48, speedMph: 125, style: 'cannon' }
```

- `id` is unique on the stage; `kind` is one of the sixteen in `KINDS`.
- What flies has `z` (the grid's datum). A hole file may give `alt` instead, metres above
  the ground at its `x, y`; the builder turns it into `z`. What lies on the ground has none.
- `reward: { coins, points }` (a coin trail: `{ coins, bonusCoins, bonusPoints }`) overrides
  what the kind pays; whole numbers 0 to 1000.
- A `warp` names its exit in `pair`; an exit no warp fires from is an error.

### The shot result

```js
result.gadgets = [
  { id: 'barricade', kind: 'breakable', t: 0.766, x: 15.56, y: 42.23, z: 40.04, effect: 'smash', needMph: 150, style: 'wall', coins: 50, points: 100 },
  { id: 'mesa-ring', kind: 'ring', t: 2.502, x: 41.53, y: 112.72, z: 54.11, effect: 'boost', gain: 1.36, mphIn: 80.53, mphOut: 109.53, coins: 25, points: 50 },
]
```

(Canyon Run, a 150 mph drive at the flag.) In order of time; `t` is the shot's own seconds
from impact. The same contacts are in `result.sim.events` as `{ type: 'gadget', ... }`. Only
on a course with gadgets (an empty list when the ball met none).

When a gadget moved the ball (anything but coins and a landing ring), an arcade shot also
carries `result.sim.swingCarryYd`: how far the same swing carries with no gadgets (281.1 yd
there, of 305.9 yd of carry). **The swing is graded, not the gadget**: `gradeShot` reads it
for the distance score, ABSOLUTE BOMB!, CHUNK CITY! and the carry challenges.

### Coins, points, callouts (`lib/arcade.js gradeShot`)

- Every coin a gadget paid is added to the shot's coins, whatever became of the ball.
- A multiplier ring multiplies the shot's own points (`multiplier.gadget`, and `total`
  includes it); the coins that follow from points grow with them.
- The flat points (a ring, a smashed wall, a full trail) are added after the multipliers,
  but not to a ball that found a hazard (a `DISASTER` is still 0 points).
- The grade is made as ever from where the ball finishes and from the swing's own carry
  (`swingCarryYd` above). The grade carries `gadgets: { coins, points, mult, hits, kinds }`
  and tags `gadget:<kind>`.
- The callout: louder than anything about the swing (TIMBER!, a mishit, STRIPED IT!,
  ABSOLUTE BOMB!) and than finding the green (ON THE DANCE FLOOR!); quieter than a holed
  ball, a hazard, a streak or a ball by the pin (PIN SEEKER!, DART!, ROBBED!, SO CLOSE!).
  Never on a putt. The loudest of:

| id | Text | Tone | When |
| --- | --- | --- | --- |
| `full-trail` | FULL TRAIL! | epic | every coin of a trail |
| `smashed-it` | SMASHED IT! | epic | through a breakable |
| `triple-up` | TRIPLE UP! | epic | landed in a x3 ring |
| `warp-speed` | WARP SPEED! | good | into a pipe or a cannon |
| `ring-it` | RING IT! | good | through a boost ring |
| `double-up` | DOUBLE UP! | good | landed in a x2 ring |
| `thar-she-blows` | THAR SHE BLOWS! | funny | thrown by a geyser |
| `boing` | BOING! | funny | off a bounce pad |
| `pinball` | PINBALL WIZARD! | funny | off a bumper or a rail |
| `turbo` | TURBO! | good | along a speed strip |
| `denied` | DENIED! | funny | came back off a breakable |
| `stuck` | STUCK IN THE MUD! | funny | stopped by mud |

They live in `GADGET_CALLOUTS` (`lib/gadgets.js`, also `lib/arcade.js GADGET_CALLOUTS`),
beside the contract's thirty and not among them: **their voice lines are not recorded
yet** (voice id = callout id). The banner shows; the voice queue skips a line with no clip.

### Sound cues

Called through the guarded API only (`audio?.cue?.(name)`), from `scene.gadgets.onHit` in
`public/app.js`, mapped by `cueFor` in `public/render/gadget-core.js`. **None of the files
exists yet**; a cue the mix table does not know is silent. Nothing loops.

| Cue | When |
| --- | --- |
| `gadget-ring` | through a boost ring |
| `gadget-pad` | off a bounce pad |
| `gadget-bumper` | off a bumper or a rail |
| `gadget-break` | a breakable smashed |
| `gadget-coin` | a coin (at most one every 80 ms; the full set always sounds) |
| `gadget-warp` | into a mouth, and out of its exit |
| `gadget-geyser` | thrown by a geyser |
| `gadget-strip` | onto a speed strip |
| `gadget-fan` | into a wind tunnel |
| `gadget-zone` | landed in a multiplier ring |
| `gadget-thud` | a wall that held, a backboard, mud |

### The lineup (`lib/predict.js`)

The lineup flies the club through the gadgets, so its path, landing and rest are the ones
the game will play (a drive through a ring is drawn flying on; a 3-wood at the 150 wall is
drawn coming back off it). On a course with gadgets a prediction carries

```js
gadgets: { hits:  [{ id, kind, effect, t, x, y, z }],            // what the predicted shot meets
           ahead: [{ id, kind, label, distYd, offlineYd }] }     // the others within 25 m of the aim line, as far as the shot goes
```

and its `events` list the hits. The HUD marks `ahead` GADGETS AHEAD: a ball a little off the
prediction could find them. A launch in the dispersion that meets a different set of
gadgets than the predicted shot is treated as a tree hit is: it does not stretch the
landing area. A geyser is predicted as it will fire for that club's flight time.

## Placing one

In the hole file (`tools/arcade-holes/holes/<id>.js`):

```js
// a real swing flown over this hole's own ground: where a ring or a coin trail belongs
const drive = L.flight(height, TEE, PIN, { speedMph: 132, vla: 13, spin: 2800 });            // ball: 'rocket' flies it as the Rocket
const gadgets = [
  drive.ring('lake-ring', 150, { radius: 6, strength: 1.3 }),                                // across that flight, 150 m from the tee
  drive.coins('lake-coins', 40, 200, 6),                                                     // six coins from 40 m to 200 m along it
  L.gadget('zone', 'shelf-x3', 48, 266, { radius: 10, mult: 3 }),
  L.gadget('strip', 'runner', -9, 224, { size: [34, 40], heading: 55, strength: 8, maxMps: 11 }),
  L.gadget('pad', 'spring', 82, 188, { radius: 6, heading: L.bearing([82, 188], PIN), angle: 50, minMps: 35, maxMps: 35 }),
];
module.exports = { ..., props, gadgets, ... };
```

`L.flight(...)` returns `{ carryM, apex, heading, at(distM), ring(id, distM, opts),
coins(id, fromM, toM, n, opts) }`. Then:

```
node tools/arcade-holes/build.mjs --check --only <id>      # validates
node tools/arcade-holes/preview.mjs --only <id>            # the map, gadgets drawn in their colours
```

and play it (`POST /api/test-shot`, or a `Game` in a test) aiming at the gadget on purpose.

`validateCourse` refuses a gadget that

- is not sound (`normalizeGadgets`: an unknown kind, a size out of range, a warp without its exit),
- reaches outside the height grid or out of bounds,
- stands on ground it may not: what lies or stands on the ground needs rough or fairway
  under every part of it (a pad, a geyser, a bumper, a rail, a backboard, a funnel, ice, mud
  and a zone may be in sand; a geyser may be in water or lava; a funnel and a zone may be on
  a green; nothing but a coin trail or a ring reaches a tee). What hangs 3 m or more above
  the ground stands on nothing,
- is cut by the ground (a ring's foot under it, a coin under it),
- is solid, or mud, within 18 m of a tee; is solid within 6 m of the hole's routing line
  (`hole.line`, the SAFE way home; a small round thing hanging in the air is exempt); is
  solid on or against a green,
- is a warp whose exit fires the ball into water or out of bounds,
- makes a match stage carry fewer than 3 or more than 8 (a warp and its exit count as one),
- touches the ball in a sudden-death arena: only a coin trail may hang there.

`test/gadgets.test.js` also holds every stage to the dead-lie guard with the gadgets in
play: a spot in or beside a gadget may be dead only where the bare ground already was.

## Design rules

- **Readable from the tee.** Everything has a beacon and a bold shape; a ring's radius is
  sized for its range (6 to 9 m between 110 and 190 m out is two to four degrees of aim).
  A breakable wall wears its number.
- **A gadget reinforces a route, it does not replace one.** A ring belongs on the RISKY line
  where the drive that falls just short passes, so it turns a near miss into a carry and the
  full drive flies over it untouched. Do not hang one where a strong, well-struck ball
  passes: on the rocket holes a ring hung for the weak Rocket was also met by a strong one
  launched low, or blown downwind (a 140 mph ball finished on the roof of Sky Fortress's
  keep), so all three carry a pad on the slope under the lip instead: only a ball that has
  already landed short meets it.
- **Help below, never harm above.** A geyser, an updraft or a pad that rescues should be low
  (a 14 m column, a 44 m ceiling): the good ball flies over it, the ball that was going in
  the hazard meets it.
- **A speed strip rewards the lay-up.** Lay it where a safe ball ROLLS (it does nothing to
  one that is still bouncing), pointing down the next leg, with a `maxMps` that does not run
  the ball through the fairway.
- **A solid never blocks the safe way home** (validated), and never traps a ball (the 12 m
  rule). Put breakables on the hero line, backboards behind greens, bumpers on the fringe.
- **Nothing is luck.** No randomness. A geyser is the one gadget a player cannot time; keep
  them off the lines a good shot takes, as hazards' edges that only ever help.
- **The 150 wall** (the owner's): `breakMph` is the launch monitor's ball speed, so the
  number on the wall is the number the player sees. Guard a shortcut with it, and make what
  lies behind it worth it.
- **A throw lands the ball on the green, not at the flag.** A pad with a fixed heading and
  speed, or a pipe's exit, puts every ball on the same spot: aim it at the front of the
  green and leave a putt (the first cut of three of them left a tap-in every time).
- **Three to eight a stage; more is not better.** Sudden death stays pure: coins only.

## What each stage carries

| Stage | Gadgets |
| --- | --- |
| Lagoon Island | `bar-runner` strip on Turtle Bar (SAFE); `flag-x2` / `flag-x3` bullseye round the flag; `turtle-shell` pad on the beach (a ball short in the sand is thrown onto the green); `sea-wall` backboard behind the island (a 5-iron hit long drops by the green); `skull-coins` over Skull Rock (ROCKET) |
| Canyon Run | **`barricade`, the 150 mph wall**, hanging 45 m out on the line at the flag, and `mesa-ring` (x1.36) behind it: 150 to 165 mph goes through both and finishes on the mesa, `mesa-wall` (backboard) stops the hot one; 149 mph comes back to the foot of the butte. `ramp-runner` strip at the turn (SAFE: a 135 mph drive is carried up the ramp, 86 yd left for 128); `porch-x2` and `gorge-coins` on the East Rim line (RISKY) |
| Lighthouse Point | `updraft` fan in the cove on Smugglers' Cut (lift 8 m/s2 under 44 m: a 118 to 140 mph Cut that was in the sea makes the headland; 150 flies over it); `cut-x2`; `crates-a`, `crates-b` (100 mph breakables); `cliff-rail` along the fairway's seaward edge; `headland-runner` strip at the corner (SAFE); `cove-coins` (ROCKET) |
| Volcano Drop | `jaws-ring` in the gate between the fangs (x1.05); `flag-x3`; `terrace-x2` (SAFE); three lava vents `reef-vent`, `west-vent`, `east-vent` (14 m columns: a chunked wedge of 70 to 80 mph is thrown onto the reef; a ball flying to the island passes over); `jaws-coins` (ROCKET) |
| Frostbite Ridge | `lake-ring` (x1.3) over the ice on the line at the flag: the 132 to 138 mph drive that was on the ice makes the far shore; `shelf-x3`; `snowman-west`, `snowman-east` on the shelf; `black-ice` on the ridge (SAFE: a drive slides on 25 to 30 yd); `cirque-coins` (ROCKET) |
| Sakura Garden | `festival-lantern` (a pinata hanging on the line at the flag: a wedge bursts it for coins and flies on untouched); `tea-bowl` funnel by the flag; `koi-rail` on the pond's bank; `moss-runner` strip at the end of the Moss Path (SAFE); `falls-coins` (ROCKET) |
| Temple Run | `drive-x2`; `mud-bank` across the end of the fairway (a 160 mph drive stops in it, short of the first river); `stone-drum` pad on the island's far bank (a lay-up that would have run into the second river is thrown onto the forecourt); `serpents-mouth` pipe at the foot of the stairs, fired from `serpents-tail` onto the green; `temple-coins` (ROCKET) |
| Pharaoh's Gate | `gate-ring` (x1.25) where a 132 to 145 mph drive at the flag comes down toward the pool; `gate-x3` on the apron; `caravan-road` strip down the left fairway (SAFE: 45 yd left instead of 90); `oasis-spring` pad at the end of the right fairway (thrown onto the green); `court-coins` (ROCKET) |
| Midnight Mile | `neon-mile` strip up the Boulevard (SAFE); `harbour-ring` (x1.25) for the 115 to 128 mph drive at the Docks; `docks-x3`; at the stadium green `kick-off` funnel and `bumper-left`, `bumper-mid`, `bumper-right` behind it; `harbour-coins` to the Helipad (ROCKET) |
| Sky Fortress | **`great-bombard`, a cannon** on the Rampart ledge (a plain drive of about 140 mph, or a Rocket that came up short, is fired into the courtyard from `bombard-muzzle`); `siege-ladder` pad on the upper ramp (a Rocket struck at about 100 mph is thrown over the lip); `courtyard-x3`; `powder-trail` strip on the floor fairway; `keep-coins` up the Rocket's flight. Nothing hangs in the Rocket's way |
| Dragon's Spine | the geyser field `jaw-vent`, `jaw-vent-west`, `jaw-vent-east` across the foot of the Jaw (a plain 125 to 152 mph drive that was in the lava is thrown onto the scree); `dragons-step` pad on the scree under the Spine's lip (a Rocket struck at about 104 mph is thrown onto the Spine); `dragons-tail` pad beyond the Spine's far end (a Rocket of 160 mph and more that runs off it is thrown into the caldera, by the flag); `terrace-x2`; `spine-coins`. Nothing hangs in the Rocket's way |
| Summit Express | `headwall-step` pad on the snow under the valley's lip (a Rocket struck at 96 to 100 mph is thrown into the hanging valley); `blue-ice` on the valley floor (a Rocket slides on toward the Bench); `snowman-west`, `snowman-east`; `ice-ramp` pad at the Bench's far edge (thrown over the crevasse); `express-coins`. Nothing hangs in the Rocket's way |
| Bullseye Bay, Thunder Dome, Ice Pick | one coin trail each along the flight that finishes by the flag (`bay-coins`, `dome-coins`, `summit-coins`); nothing that touches the ball |
