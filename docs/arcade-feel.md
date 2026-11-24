# Arcade feel: turning a real swing into a video game

_2026-11-14. Design for the `arcade` branch. Read with `docs/dev/arcade-game-plan.md`._

## The core idea

In a mobile arcade golf game the player's whole input is one timing tap. Everything else, the
aim guide, the flight, the bounce, the crowd, is the game performing for them.
On a simulator the input is a real swing, which is richer and far less
repeatable. So the design rule is:

> **The swing is the only skill input. Everything before it is set-up the game
> makes easy; everything after it is a show the game puts on.**

That gives three phases per shot, each with its own job.

| Phase | Real golf | Arcade |
|---|---|---|
| **Before** (10 to 20 s) | Read the hole, pick a club, aim your body | Game aims at the flag for you, shows a landing ring for the club, wind as one arrow, and the power-up dock. One decision: which ball. |
| **Impact** (instant) | You feel it | Verdict from launch data before the ball has gone 10 yards: PERFECT / GREAT / GOOD, hit-stop, strike sound scaled to ball speed. This replaces the timing needle of a mobile arcade golf game. |
| **After** (5 to 13 s) | Watch it, walk | Cinematic flight, slow motion at the moments that matter, crowd scripted from the known path, points, coins, streak. Then straight to the next shot. |

## Why each mechanic exists

### 1. Slow motion (`public/arcade/feel.js`, done, tested)

The server computes the whole path at impact, so the client knows the future.
`warpShot` re-times the path before it is animated; where the ball goes is never
changed. The rule (the user's, non-negotiable): **time slows only when the ball
comes by the pin, never on the landing.** The pitch, the bounce and the check
always play at full speed.

| Window | When | Speed |
|---|---|---|
| strike | first 0.08 s of a shot of 95 mph or more, or of any Rocket ball (a hit-stop: a quarter of a second on screen, no SLOW-MO tag worth reading) | 35% |
| lip | a moving ball, down and past its landing, passing within 1.1 m of the cup (0.45 m for a putt): from 0.7 s before to 0.45 s after | 33% (putt 50%) |
| holing | a ball that goes in, **from when it closes on the cup**: once it is (and stays) within 3 m of it (putt 2.2 m), the last 1.8 s of the roll at most (putt 1.5 s) | 50% (putt 55%) |
| holing, deep | the same window from 1 m out (0.9 m), the last 0.8 s at most, **through the drop and the hold** | 30% (putt 38%) |

Nothing starts before `LANDING_CLEAR_S` (0.9 s after touchdown), nor in the first
`PUTT_CLEAR_S` (0.35 s) of a putt. The one case with no roll to slow, a ball that
flies or pitches straight in, plays its flight and pitch at full speed and slows
only the drop itself (30%). A ball that merely stops near the flag gets no slow
motion: the camera does that job (the pin cam, below).

Dull stretches (mid-flight, long run-outs) play up to 3x fast, so no shot is on
screen longer than `MAX_PLAY_S` (13.5 s), the drop and the hold included. Windows
are returned in playback time (`sim.slowmo`; a holing window carries
`deep: { t0, rate }`) so the HUD (letterbox, crowd swell) and the audio
(`slowmo-in` / `slowmo-out`, crowd duck) stay in sync.

### 1a. The drop (`feel.js` `cupDrop`, `render/cup-fx.js`, done, tested)

The server's path ends by putting a holed ball on the pin the instant the cup
takes it (up to a cup's radius away: 0.57 m with easy putting, metres for a
Magnet ball), so played as it comes the ball jumps to the flag and sits on the
green. `warpShot` replaces that last sample with a real finish:

1. **the run in**: from where the cup took it, on a curve that leaves along the
   ball's own line and ends on the cup, at its own pace (0.7 to 2.5 m/s);
2. **the tip**: once its middle is within 10 cm of the cup's it starts to fall; a
   ball arriving at 1.6 m/s or more first hits the back of the cup and hops;
3. **the drop**: it falls 20 cm, under the turf and out of sight (the scene draws
   the ball at the path's depth below the green and hides it at the bottom);
4. **the hold**: 0.8 s on the cup, the ball gone, before the shot is over.

At the bottom the cup bursts (`cup-fx.js`: a flash out of the hole, two rings of
light across the green, a fountain of sparks, 1.4 s). The flagstick is lifted out
and faded as the ball closes on the cup (every putt once it rolls; a close one
once the ball is down within 2 m), so it never stands between the camera and the
ball, and drops back when the camera returns to address. For the ball cam the cup
is drawn 1.6x its usual size, so the ball (itself drawn four times life size)
visibly fits in it.

**For audio and the HUD**, a holed shot's re-timed sim carries, in playback
seconds from impact:

| Field | Meaning |
|---|---|
| `sim.cupDropT` | the ball is down in the cup and out of sight: play `cup-drop` here |
| `sim.cup` | `{ x, y, z, t0, tTip, tDrop, tEnd }`: taken by the cup, starts to fall, down (= `cupDropT`), end of the hold (= `sim.playS`) |
| `sim.events` | gains `{ type: 'cup-drop', t: cupDropT, ...cup }`; the server's `'holed'` event is given `t = cupDropT`, so everything already keyed to it (the HUD's roar, confetti and `cup-drop` cue) lands on the drop |

### 1b. The camera: ball cam and pin cam (`public/render/flight-camera.js`, done, tested)

Three shot cameras, chosen in Settings > Shot camera (`?shotcam=ball|follow|tv`):
**Ball cam** (the arcade default, saved under its own key), **Follow the ball**
(the camera as it was) and **TV**. Each is one continuous move from the address
camera, worked out once per shot from the known path.

**Ball cam** is the arcade-golf idiom: the camera leaves the tee and
flies *with* the ball.

- In the air it chases a spot 5.5 m behind the ball, level with the ground along
  the ball's heading, and high enough above it that, looking forward and about 9
  degrees down, the ball sits just under the middle of the frame with the hole
  laid out ahead and below. The steeper the ball falls the further down it
  looks (up to 30 degrees), so the ground it is falling to comes up the frame.
- The ball gets away at impact and the camera catches it up over 1.5 s; it is
  sprung to what it chases, so the ball always leads it a little.
- Speed is felt: the lens opens by up to 14% between 35 and 80 m/s on screen (a
  Rocket ball gets all of it); a curving flight banks the camera into the turn
  (up to 7 degrees); the ball is drawn up to 2.4x bigger high in the air.
- The heading follows the flight (a slice swings the camera round behind the
  ball) and is **held from touchdown**: a ball that spins back or kicks off a
  slope never turns the camera round, and a ball knocked back by a tree does not
  flip it.
- A second before touchdown it brakes to the landing vantage, 11 m behind where
  the ball comes down and 3.4 m up, never nearer than 3.5 m behind a ball still
  falling; it films the pitch and every bounce from there at full speed, then
  closes to 4.8 m behind and 1.6 m up as the ball runs out of pace.
- It is lifted, smoothly, over the ground (2 m in flight, 1 m on the roll), over
  the tree crowns, and over any ground between it and the ball (a ridge, a cliff
  lip); the look is leashed so the ball never leaves the frame.

**Pin cam.** Because the path is known, the shot is called at impact
(`closeOne`): a close one is **holed**, or passes, moving, within lip distance of
the cup (**lip**), or finishes within 15 ft (**close**). Every putt gets it too.

- After the landing (from 0.45 s after touchdown, over about a second; a putt
  from the start) the chase eases down and in to 3.7 m behind the ball and 1.1 m
  up, closing to 2.5 m and 0.5 m as the ball slows or reaches the cup, the lens
  closing from 1.3x to 2x (lip 1.8x, close 1.7x). No cut, no change of side.
- It swings round the ball, never more than 50 degrees, to put the cup ahead of
  the ball, and stands 12 degrees off the line so the ball does not hide the
  hole. It looks between the two, a little above them: ball and cup in the lower
  half of the frame, the far edge of the green and the horizon above.
- Once the ball is past the cup (a lip-out) the camera stays behind the *cup*, so
  the cup never leaves the frame. A ball that pitches past the flag and spins
  back is watched over the cup from the side it came from.
- Straight in (holed within 0.7 s of touchdown): the lens is already closing on
  the flag over the last 1.4 s of the flight, and the camera pushes in on the cup
  through the drop.
- The landing ring and its carry label fade out of the close-up; the lens holds
  on the cup until the camera goes back to address.

Tests (`test/ball-camera.test.mjs`, shots from `test/helpers/camera-shots.mjs`)
film sixteen real shots frame by frame: a wedge that spins back to a foot, a
7-iron that releases 30 ft and drops, one that spins back into the hole, a
chip-in, a 40 ft and a 6 ft putt, a lip-out, a slam dunk, a ball 10 ft away; a
drive, a 500 yd Rocket drive, a high wedge, a big slice, a shot off a 60 m cliff,
one up onto a butte 80 m above and one into its wall. For each: position, speed
and view change continuously, the camera never crosses to the far side of the
ball, the ball stays inside the frame, and the camera is never under the ground,
behind ground, or inside the ball.

### 1c. The address camera: see over it, see through it, or fly up (`render/see-over.js`, `render/see-over-rig.js`, done, tested)

A player standing at a real mat has to SEE where they are hitting. The stages are
vertical (cliffs, buttes, 100 m of relief) and dense (woods, 250 props), and the
plain address camera, 14 m behind the ball and 4.6 m up, often saw a palm trunk and
a hillside. The arcade's address camera (the plain simulator's is untouched;
`?seeover=0` gives the plain one back) does three things, none of which ever delays
a swing.

**What must be seen**: the ball, and the aim target: where the club in hand is
predicted to land and stop along the current aim (the prediction the HUD already
draws, turned with the aim until the next one arrives), two points of the first part
of its flight, and the pin when it is within the club's reach. The pin is given up
before the target is.

**1. See over (the ground).** From the plain pose every sight line is tested against
the terrain. When one is blocked the camera takes the lowest pose that clears, and
glides there (a critically damped ease, about 0.6 s, never a cut):

- first it cranes UP where it stands, pitching down;
- when ball and target no longer fit one frame it also pulls BACK along the line, no
  further than it must;
- caps: 35 m above the ball, 40 m behind it.

The height is the least that clears (a formula over the ground under the sight line,
not a pick from a list), so the pose is continuous as the aim sweeps: nudging the aim
never makes it jump. A sight line clears the ground by half a metre plus 1 cm per
metre short of the target, so the ground in front of the target shows too. On open
ground nothing changes at all. The camera never stands under the ground, in a trunk
or the middle of a crown, or inside a building: it steps along the line out of one,
or rises over it. A hedge, a ruin or a low wood further down the line is looked over
too when 5 m more height does it; a tall tree far down the line is not (it would take
25 m): the line and the beacon are drawn through it instead.

**The ball is framed above the dock.** The HUD's ball dock covers the bottom of the
screen where the ball is drawn. `public/arcade/seeover.js` measures, from the DOM, how
much of the bottom of the picture is covered at its middle; the framing keeps the ball
that far up plus 3.5 % of the frame, on level, uphill and downhill lies (an uphill pin
used to push the ball off the bottom of the frame), standing and from above.

**2. See through (what stands near the ball).** One mechanism: anything standing
between the camera and the ball, or over the first 60 m of the line past it, and tall
enough to rise into the sight line, is drawn as a ghost, automatically:

- trees (`trees.js setFadeLine`): the existing see-through bucket, picked along the
  line of the shot instead of across the middle of the view;
- props (`props.js setSeeThrough`): palms, statues, ruins, buildings: the solid copy
  goes, a twin at 16 % opacity is drawn in its place (its depth first, so a model's
  overlapping faces do not add up to solid), after the aim line and the markers so
  those show through;
- a big prop the camera is inside, or that the ball at rest lies inside (QA's
  `setViewer`, which popped the model out of the picture, is this now: it fades);
- never the ground, nor what lies on it (bridges, target rings).

Everything stands solid again the moment the shot is away.

**3. Fly up (when the ground itself hides the target).** When no pose behind the ball
within the caps sees the target (a mesa wall, a butte), or the line to it runs under
more than 30 m of trees (a wood, not a tree), the camera rises by itself, in about a
second and a half, to the VIEW FROM ABOVE: 40 to 110 m up behind the ball, looking
down the way to the pin, the ball at the bottom of the frame and the green near the
top, and holds there for the swing. It only does so once a shot is lined up (never on
a guess) and once the aim has rested 0.35 s (sweeping the aim does not yo-yo it).

The same view is there on demand, any time: the **V** key, or the big **VIEW FROM
ABOVE** button under the wind (it turns gold and reads BACK TO THE BALL while up). A
tap or a click toggles; holding V is a peek, back down on release. A new lie starts
from the camera's own choice again. No flyover is ever auto-played.

**What is drawn through what remains** (`lineup-fx.js`):

- the predicted line, the roll and the target's ring get an x-ray copy (depth test
  off, 40 % alpha, the same dashes, drawn first): behind ground, a wood or a building
  the line carries on, dimmer;
- the target carries a beacon, a thin column of light 22 to 70 m tall that thins
  toward its top; the pin gets the same (red) whenever ground hides it;
- a target or a pin that is off the frame or behind ground gets a marker pinned inside
  the frame with its distance and height: `PIN 142 YD · +50 M ↑`.

**The hand-over to the ball cam.** A ball struck with the camera raised, or mid-glide,
is followed from wherever the camera is: `playShot` hands `flightCameraPlan` the
camera's position, its look and now its velocity. From a camera standing higher or
further back than the plain address spot the ball cam runs its chase from the plain
spot, as from any lie, and the camera rides an offset onto it that eases away over 0.8
to 3.6 s (28 m/s): it starts exactly where the address camera is and comes down with
the shot instead of diving at the ball at 250 m/s. After a shot the address camera is
the plain one until the next lie is lined up: in a match the picture holds on the
finished shot for two seconds first, and nothing of this moves the camera under that
hold; the glide to the new pose starts when the next prediction is drawn.

Tests: `test/see-over.test.mjs` (13: flat ground unchanged; a brow 4 m high 20 m
ahead; a 30 m hill 80 m ahead; a ridge that needs the pull-back; a wall 60 m high 150
m ahead reported not visible and seen from above; continuity over an aim sweep of 90
degrees either side; out of trees and buildings; the pin given up first and a bunker
lip; the ball above the dock on six slopes; the dock measure; the key and the button;
the wiring) and `test/ball-camera.test.mjs` (two more: all sixteen shots filmed from
the see-over caps and from the view from above, and a strike mid-glide).

### 2. Easy putting (`lib/putt-assist.js`, done, tested)

Putting is where simulators feel worst: mats are flat, launch monitors read slow
rolls poorly, and nobody can see a break on a projector. So on the green the
game reads the putt for you.

- `solvePutt` shoots the real roll physics to find the bearing and pace that
  finish 35 cm past the cup, break included.
- `assistPutt` then pulls the player's stroke toward it. Start-line error and
  pace error are both shrunk; the cup is made larger and takes a faster ball.

| Level | Line error kept | Pace error kept | Cup |
|---|---|---|---|
| off | 100% | 100% | real |
| assist | 50% | 60% | 1.6x |
| easy (default) | 20% | 15% | 2.6x |

In easy mode a decent stroke goes in from anywhere, and a terrible one leaves a
tap-in. Anything from the green counts as a putt (no accidental chips), and
tap-ins inside 8 ft are conceded automatically. The stroke itself is still
graded (`pure` / `good` / `poor`) so the HUD can say PURE ROLL.

### 3. Forgiveness on full shots (server, `assist.dispersion`)

Side spin and start direction are scaled to 60%. A 20-yard slice becomes a
12-yard fade: still your shot shape, but it stays on the hole. Real-golf
punishments that are not fun on a couch are softened: rough costs little
distance, and there are no lost balls, only drops.

### 4. Over-powered balls

Seven power-ups (Rocket, Sticky, Magnet, Windcutter, Laser, Moonball, Bouncy),
earned by streaks of good real shots, armed before the swing. They bend the
physics openly. A power-up shot scores half points, so skill still wins a
match.

### 5. Fair player-versus-player

Two people on one bay hit very different distances. Later phases add a **bag
equaliser**: each player's shots are scaled so their own average 7-iron flies a
standard 7-iron distance (Open-Birdie already records the last 30 shots per
club in `lib/bag.js`). Until then, tiers by handicap.

### 6. Pace

One hole, three or four swings each, the result settled the instant it is
decided (no dead swings), then a closest-to-the-pin shootout if tied. A match is
about five minutes.

## What makes it feel like a game, in priority order

1. Sound. The repo had none. Strike, crowd bed, swell, roar, stings.
2. The verdict banner at impact and the grade at rest.
3. Slow motion at the cup, and the ball seen dropping into it.
4. A camera that flies with the ball and goes where the drama is.
5. Numbers that go up: points, coins, streak, level.
6. Colour: saturated turf, turquoise water, a glowing tracer.

## Building the 3D world: options researched

Open-Birdie draws a course procedurally from JSON: a terrain mesh from a height
grid, a turf shader splatting fairway/green/bunker polygons, instanced trees,
and water planes. Four ways to get from there to the concept art:

| Approach | What it is | Gameplay-accurate ground | Art quality | Cost | Verdict |
|---|---|---|---|---|---|
| **A. Procedural + arcade look** | Hand-authored course JSON, a saturated render preset | Yes, physics and visuals share one height grid | Medium | Free | **Phase 1. In build.** |
| **B. Generated hero props** | Concept image → isolated prop image → image-to-3D mesh (GLB) → placed via `course.props` | Props are scenery only | High where it counts | ~38 credits a prop | **Phase 1. Proven: lighthouse mesh made.** |
| **C. Blender-authored holes** | Model the whole hole in Blender, export GLB plus a height map and a surface mask | Yes, if the height map is exported alongside | Highest, full control | Artist time | **Phase 2.** Needs a local Blender install and an exporter script. |
| **D. Generated worlds (Gaussian splats)** | A world model such as World Labs Marble turns an image into a 3D scene; exports splats plus a coarse collider mesh; renders in three.js through their Spark renderer | Only approximately: the collider is low fidelity and needs aligning | Very high from intended viewpoints | Per-world fee | **Backdrops only.** Good for scenery beyond the playable area, not for the ground a ball rolls on. |

Stylised rendering notes for approach A: three.js `MeshToonMaterial` with a tiny
nearest-filtered gradient map gives banded toon shading; outlines come from
`EdgesGeometry` on hard-edged props or a depth/normal edge post-pass. Both are
optional follow-ups; palette, light and water colour carry most of the look.

**Decision:** A plus B now, because the ball must roll on the same surface it is
drawn on, and procedural terrain guarantees that. C is the route to
art-directed holes once the feel is right. D is for skyboxes and far scenery.

## Asset pipeline for one hole

1. Concept image (done for six themes, `docs/art/concepts/`).
2. Layout in `tools/arcade-holes/holes/<name>.js`: polygons, height field, trees, prop markers.
3. Hero props: isolated image → mesh, saved to `public/arcade/props/<kind>.glb`.
4. Load with the arcade look on, screenshot, compare with the concept, iterate.

Sources: [three.js MeshToonMaterial](https://github.com/mrdoob/three.js/blob/master/src/materials/MeshToonMaterial.js),
[MeshToonMaterial tutorial](https://sbcode.net/threejs/meshtoonmaterial/),
[World Labs Marble](https://worldlabs.ai/blog/marble-world-model),
[Marble essentials](https://help.scenario.com/articles/4774055514-marble-by-world-labs-the-essentials).
