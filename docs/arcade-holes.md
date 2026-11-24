# Arcade holes: hand-designed courses

Open-Birdie builds its courses from OpenStreetMap and elevation tiles. The arcade layer
also needs holes that exist nowhere: short, dramatic, built for a one-hole head-to-head
match. `tools/arcade-holes/` writes such holes as the **same course JSON** the app already
loads, so the game, the renderer, the course cache and the picker treat them like any
cached course. No file under `lib/`, `public/` or `server.js` was changed for this.

## The catalogue: one hole, one world

Every match hole is a **stage**: its own single-hole course with its own theme, sky and
wind (`docs/dev/arcade-v2-contract.md`, section 1). Nine match stages make the Clash Tour;
three more are tiebreak arenas, reachable par 3s for closest to the pin. Each stage is one
file in `tools/arcade-holes/holes/`, and the catalogue is simply every file there that
exports a `stage`.

<!-- STAGE-TABLE:start (node tools/arcade-holes/table.mjs --write) -->
| # | Stage (`id`) | File in `data/courses/` | Role | Theme, time | The hole | Wind (mph) | Routes | On the intro screen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Lagoon Island (`lagoon-island`) | `osm-node-9900000000001.json` | match 1 | tropical, day | par 3, 151 yd, 13 m down | 2 to 9 | safe: Turtle Bar; risky: The Lagoon; rocket: Over Skull Rock | Over the lagoon to an island green: round by the sandbar, or a Rocket over Skull Rock. |
| 2 | Canyon Run (`canyon-run`) | `osm-node-9900000000002.json` | match 2 | canyon, golden | par 4, 357 yd (310 straight) | 5 to 14 | safe: The Canyon Floor; risky: The East Rim; rocket: Over the Top | Up the canyon floor, across to the East Rim, or a Rocket over the gorge to the mesa. |
| 3 | Lighthouse Point (`lighthouse-point`) | `osm-node-9900000000003.json` | match 3 | links, day | par 4, 354 yd (296 straight) | 10 to 22 | safe: The Links; risky: Smugglers' Cut; rocket: The Lighthouse Line | Clifftop links in the wind: round the cove, cut its corner, or a Rocket over it all. |
| 4 | Volcano Drop (`volcano-drop`) | `osm-node-9900000000004.json` | match 4 | volcano, dusk | par 3, 191 yd, 34 m down | 4 to 12 | safe: The Ash Terrace; risky: Through the Jaws; rocket: Over the Jaws | From the crater rim to an island in the lava: through the Jaws, or a Rocket over them. |
| 5 | Frostbite Ridge (`frostbite-ridge`) | `osm-node-9900000000005.json` | match 5 | alpine, day | par 4, 388 yd (333 straight), 35 m down | 4 to 10 | safe: The Ridge; risky: Over the Ice; rocket: The Glacier Cirque | From the summit: ski the ridge, carry the frozen lake, or rocket into the glacier. |
| 6 | Sakura Garden (`sakura-garden`) | `osm-node-9900000000006.json` | match 6 | sakura, day | par 3, 136 yd, 16 m down | 0 to 7 | safe: The Moss Path; risky: Over the Koi Pond; rocket: Off the Great Falls | A wedge through the blossom to a green wrapped in koi ponds, under the Great Falls. |
| 7 | Temple Run (`temple-run`) | `osm-node-9900000000007.json` | match 7 | jungle, golden | par 5, 528 yd, 26 m down | 3 to 10 | safe: The Stepping Stones; risky: In Two; rocket: In One | Two rivers, a temple on a mountain. Three good swings get home; a Rocket in one. |
| 8 | Pharaoh's Gate (`pharaohs-gate`) | `osm-node-9900000000008.json` | match 8 | desert, golden | par 4, 301 yd (286 straight), 21 m down | 6 to 14 | safe: The Left Fairway; risky: Knock on the Gate; rocket: The Upper Court | Drivable par 4. Round the Great Sand Sea, over it, or rocket to the Upper Court. |
| 9 | Midnight Mile (`midnight-mile`) | `osm-node-9900000000009.json` | match 9, the finale | neon, night | par 5, 548 yd (485 straight), 32 m down | 6 to 14 | safe: The Boulevard; risky: The Docks; rocket: The Helipad | The finale. Rooftop tee, a harbour to cut, a stadium green behind a moat. Go big. |
| 10 | Sky Fortress (`sky-fortress`) | `osm-node-9900000000010.json` | extra 10, **rocket hole** | canyon, golden | par 3, 427 yd, 50 m up | 8 to 18 | safe: The Siege Ramp; risky: The Bastions; rocket: Storm the Keep | Rocket par 3: from the canyon floor to a fortress green 50 m up a butte in a lake. |
| 11 | Dragon's Spine (`dragons-spine`) | `osm-node-9900000000011.json` | extra 11, **rocket hole** | volcano, dusk | par 4, 604 yd | 6 to 15 | safe: The Ash Road; risky: Over the Crater Wall; rocket: The Dragon's Spine | Rocket par 4: over the lava and 45 m up to the crater rim, then down into the caldera. |
| 12 | Summit Express (`summit-express`) | `osm-node-9900000000012.json` | extra 12, **rocket hole** | alpine, day | par 5, 700 yd, 70 m up | 10 to 22 | safe: The Snow Zigzag; risky: Leap the Crevasse; rocket: The Express | Rocket par 5 up a mountain: the headwall, a hanging valley, a crevasse, the summit. |
| 21 | Bullseye Bay (`bullseye-bay`) | `osm-node-9900000000021.json` | tiebreak 1 | tropical, day | par 3, 115 yd, 27 m down | 4 to 12 |  | Sudden death from the caldera rim: one ball each at a bullseye in the bay. |
| 22 | Thunder Dome (`thunder-dome`) | `osm-node-9900000000022.json` | tiebreak 2 | stadium, night | par 3, 140 yd, 11 m down | 0 to 6 |  | Sudden death under the lights. Out of the tunnel, 140 yards, a full house. |
| 23 | Ice Pick (`ice-pick`) | `osm-node-9900000000023.json` | tiebreak 3 | alpine, golden | par 3, 105 yd, 40 m down | 5 to 14 |  | Sudden death off the summit: 40 metres straight down onto a bullseye on the ice. |
| 100 | Arcade Classics (`arcade-classics`) | `osm-node-9900000000100.json` | (legacy, not on the tour) | | stages 1 to 3 as holes 1 to 3 on one piece of ground | | | |
<!-- STAGE-TABLE:end -->

`#` is the course's `number`: its synthetic identity is `osm:node:<9900000000000 + #>`.
The table is **generated** from the catalogue as it builds (`node tools/arcade-holes/table.mjs
--write`; `--check` fails when it is stale): lengths are along the routing line with the
straight tee-to-pin distance where they differ, the drop or climb from tee to pin when it is
8 m or more, the stage's own wind range (rolled per hole, `docs/match.md`), the three routes
by name and the blurb the stage intro shows. Stages 4 to 7, 21 and 23 are tested in
`test/arcade-holes-a.test.js` and `test/arcade-holes-b.test.js`, the three extreme stages in
`test/arcade-holes-x.test.js`, the rest in `test/arcade-holes.test.js`.

Stages 1 to 9 are the Clash Tour (a `bo9` plays them in order). **Extra stages** have
`order` 10 and up (to 20: numbers 21 and on are the tiebreak arenas'): shuffle and the
quick-match picker draw from every stage. The three so far are the **extreme** stages: rocket
holes, see "The extreme stages" below.

### Stage metadata

A hole file's `stage` says where the stage comes in the tour and how it should look:

```js
stage: {
  number: 8, role: 'match', order: 8,          // role 'match' (order 1..9 the tour, 10..20 extra stages) or 'tiebreak' (order 1..3)
  name: "Pharaoh's Gate", theme: 'desert',     // tropical canyon links volcano alpine sakura jungle desert neon stadium
  origin: { lat: 24.0, lon: -152.0 },          // open ocean; latitude and longitude pick sun and sky
  conditions: 'calm',                          // optional: 'calm' | 'breezy' | 'windy'
  baseM: 0,                                    // optional altitude
  timeOfDay: 'golden',                         // 'day' (default) | 'golden' | 'dusk' | 'night': a hint for the look
  blurb: 'Drivable par 4. Go round the Great Sand Sea, or fly it and knock on the gate.',   // under 90 characters
  difficulty: 2,                               // 1 | 2 | 3
  freeBall: 'rocket',                          // optional: a rocket hole. Every tee shot is played with this ball, free
  wind: { min: 8, max: 18 },                   // optional: the hole's own wind range in mph (0 <= min <= max <= 35)
},
```

`freeBall` is a ball id of the arcade layer (`FREE_BALLS` in `lib.js`: every `POWERUPS` entry of
kind `ball`, never a trick; a test keeps the list in step with `lib/arcade.js`). The server
plays the hole's first stroke with it for every player, in matches and in solo play. `wind`
is the range the server rolls the hole's wind from each time the stage comes up; without it
the range comes from `conditions` (`calm` 0 to 5, `breezy` 6 to 12, `windy` 12 to 22).

`normalizeStage` (in `lib.js`) checks every field and names what is wrong. Two stages may
not share a `number`, or a `role` and `order`: the second file by name fails. The built
course carries the stage as

```js
course.arcade = { id, formatVersion: 2, generator: 'tools/arcade-holes', holes: [id],
                  theme, role, order, timeOfDay, blurb, difficulty, conditions?, freeBall?, wind? }
```

(`conditions`, `freeBall` and `wind: { min, max }` only when the hole asks for them, in that order). Arcade Classics is not a stage and keeps
`{ id, formatVersion: 1, generator, holes: [three ids] }`.

### The tour manifest

`build.mjs` also writes `<dataDir>/arcade-tour.json`, which the match engine and the lobby
read to know what there is to play:

```json
{ "version": 1,
  "stages":    [ { "id": "lagoon-island", "order": 1, "number": 1, "file": "osm-node-9900000000001.json", "name": "Lagoon Island", "par": 3, "lengthYd": 150, "theme": "tropical", "timeOfDay": "day", "blurb": "...", "difficulty": 1 } ],
  "tiebreaks": [ { "id": "bullseye-bay", "order": 1, "number": 21, "file": "osm-node-9900000000021.json", "name": "Bullseye Bay", "par": 3, "lengthYd": 115, "theme": "tropical", "timeOfDay": "day", "blurb": "..." } ] }
```

An entry also carries `"freeBall": "rocket"` and `"wind": { "min": 8, "max": 18 }` when the
stage has them (after `difficulty`, in that order; absent otherwise).

Both lists are sorted by `order`, so the extra stages follow the nine of the tour. A tiebreak entry has no `difficulty` (the contract's
shape; `course.arcade.difficulty` has it). Only stages that built and validated, and whose
course file is in the data dir, are listed: a stage that is missing or broken is simply
absent, so consumers must cope with fewer (or more) than nine stages and zero to three arenas.
`lengthYd` is the routing line's length, as on the hole card.

### When a hole file is broken

Each hole file is loaded and built on its own. One that throws when required, exports the
wrong `id`, has a bad `stage`, or fails validation is reported by name
(`FAILED  <id> (holes/<id>.js): <why>` on stderr) and `build.mjs` exits with code 1, but
every other course is still written and the manifest lists them. `Sim Clash.bat` stops on
that exit code, so a broken hole is noticed before anyone plays.

## Build, load, test

```
node tools/arcade-holes/build.mjs              # every course into data/courses/, and data/arcade-tour.json
npm run arcade:holes                           # the same
node tools/arcade-holes/build.mjs --check      # validate only: writes nothing
node tools/arcade-holes/build.mjs --only pharaohs-gate --out D:\some\data\dir
node tools/arcade-holes/preview.mjs            # top-down PNG maps of every course in .shots/arcade-holes/
node --test test/arcade-holes.test.js          # the tools, the catalogue, stages 1, 2, 3, 8, 9, 22
node --test test/arcade-holes-x.test.js        # the extreme stages 10, 11, 12 (rocket holes)
```

`data/` is not in git, so the files must be built once on every machine (and again after a
design change). `--out` defaults to `BIRDIE_DATA_DIR`, else `<repo>/data`. `--only` writes
that one course; the manifest then lists the stages whose files are already in the data
dir. `ARCADE_HOLES_DIR` points the catalogue at another directory of hole files (the tests
use it to prove that a broken hole fails alone).

Once built, the courses are in the course picker, in `GET /api/courses` and in
`GET /api/courses/cached`. To load one:

```
POST /api/load-course   {"cached": "osm-node-9900000000001.json"}
POST /api/load-course   {"osmType": "node", "osmId": 9900000000001}
```

Both forms were checked against a running server; neither touches the network. From
Windows PowerShell 5.1 (port 921 is taken when GSPconnect is running):

```
$env:BIRDIE_OC_PORT = '9921'
node server.js
Invoke-RestMethod -Method Post -Uri http://localhost:8222/api/load-course -Body '{"cached":"osm-node-9900000000002.json"}'
```

Network: an arcade course carries markers that say "scenery already looked for" (see
`buildings`, `scenery`, `canopy`, `enrichment` below), so the background scenery enricher
finds nothing to fetch and stays silent even with enrichment on. `BIRDIE_ENRICH=0` turns
the enricher off altogether, and `BIRDIE_SKY_PREFETCH=0` stops the unrelated sky downloads.

## The course format, as an arcade hole uses it

Coordinates are local metres, x east, y north. Everything below was read from the loader
(`lib/course.js`, `lib/course-identity.js`, `lib/resolved-course-package.js`), the game
(`lib/game.js`) and the renderer (`public/render/scene.js`).

| Field | What reads it, and what it must be |
| --- | --- |
| `version` | Must equal `CACHE_VERSION` in `lib/course.js` (4), or the file is not listed and not loaded. |
| `name` | The picker and the HUD. |
| `source` | **Required to load through the server.** Only `{ osmType: 'node'\|'way'\|'relation', osmId: positive integer }` is accepted (`normalizeCourseSource`); activation, the content revision, the cache index and the scenery files are all keyed by `osm:<type>:<id>`. A made-up `{ kind: 'arcade' }` is rejected. Arcade courses use node ids `9900000000000 + n`, far above real OpenStreetMap ids. A course with no `source` still works in a bare `Game` (tests), but `POST /api/load-course` refuses it. |
| `origin` | `{ lat, lon }`. Sun, sky and map tiles only. Arcade courses sit over open ocean on purpose: nothing real is there to be downloaded. Azalea beds are planted under trees when the latitude is under 37 degrees. |
| `surfaces` | `[{ kind, poly }]`, polygons of 3+ points, no holes. Kinds the game and renderer know: `green`, `fairway`, `tee`, `bunker`, `water`, `rough`. Where polygons overlap the game plays the first of **water, bunker, green, tee, fairway** (`PRIORITY`), whatever their order in the array. Ground under no polygon is rough. `rough` polygons only tint the ground. An `ob` polygon is accepted and then ignored. |
| `boundary` | One polygon. A ball is out of bounds once it is more than 15 m **outside** it; this is the only source of out of bounds. It must cover 10,000 m2 or more and contain every tee and pin, or it is ignored with a warning. The renderer also sizes its ground to it, so keep it inside the height grid. |
| `holes` | `[{ ref, par, name, tee, pin, line, lengthYd, note?, greenNote?, routes? }]`. `routes` is `[{ id: 'safe' \| 'risky' \| 'rocket', name, note }]`, the ways to play the hole, shown on the stage intro (see "Routes"). The ball starts at `tee`; the hole is cut at `pin`; `line` is the routing (tee first, pin last) and `lengthYd` its length. The game checks only that tee and pin are finite, so `validateCourse` checks the rest: pin on a green, tee on a tee, length right. `name` shows unless it looks like "Hole 7". `note` and `greenNote` show on the hole card. |
| `trees` | `[[x, y], ...]`: drawn as trees and played as obstacles (trunk and crown). The renderer picks the species; there are no palms or cacti. Trees on a tee, fairway, green, bunker or water, or within 3 m of a par 3's line, are dropped. |
| `woods` | Polygons filled with trees by the renderer (not obstacles). Unused so far. |
| `elevation` | `{ minX, minY, cellM, nx, ny, baseM, heights }`: a grid, row j at `y = minY + j * cellM`, `heights[j * nx + i]` in metres above `baseM`, rounded to a centimetre. Physics and the terrain mesh sample it bilinearly and clamp past its edge. `patches` (lidar greens) is not used. |
| `buildings`, `scenery.water`, `canopy`, `enrichment.aerial` | Scenery layers the enricher would otherwise fetch. Arcade courses carry them filled in: `buildings: []`, `scenery: { water: [] }`, `canopy: { source: 'arcade', trees: [[x, y, heightM, crownRadiusM], ...] }`, `enrichment.aerial: { status: 'none', at: '2999-...' }`. `canopy.trees` holds the same trees as `trees` with sizes; the renderer and the tree obstacles prefer them. |
| `props` | `[{ id, kind, x, y, rotDeg, heightM }]`: set pieces for the props layer (`public/render/props.js`). Scenery only, no collision. The kinds are listed under "Props" below. Nothing else reads the field; the loader, the game and the activation path pass it through untouched (tested). |
| `arcade` | `{ id, formatVersion, generator, holes: [hole ids], ... }`: marks the course as hand-made. A stage (format 2) adds `theme, role, order, timeOfDay, blurb, difficulty` and, when the hole asks for them, `conditions` (see "Stage metadata"). `conditions` is a hint (`'windy'` on Lighthouse Point) for the match layer to apply; nothing here applies it. |

No aerial photo and no NDVI classmap are needed: without them the renderer paints
procedural turf from the surface polygons. Checked in the running app on all three holes.

### Water: a polygon or the sea

There are two ways to make water, and they behave differently.

**A `water` polygon** (the gorge on Canyon Run). The game plays every point inside it as
water. The renderer draws a water plane at the median ground height inside the polygon and
carves the whole polygon down to a bed below that level. So:

- keep the ground inside it low and level, below the mown ground beside it;
- never lay a water polygon over land that should stay dry: an island inside one would be
  carved away. A moat needs `ring()`, which returns wedge-shaped pieces round the island.

**The sea** (Lagoon Island, Lighthouse Point). No polygon at all. `public/render/sea.js`
finds a sea in the height grid, and `lib/course.js` plays what it finds as water. It is
found when the lowest ground is one level (within 2 m), covers 2 % of the grid or more,
reaches the grid's edge, and no more than 3 % of the tee, fairway and green corners lie
under it. In return the renderer draws open water to the horizon, with surf, and paints
beaches and cliffs. Rules that follow:

- make the sea **exactly** one height (0 in the two sea holes). Use `bump()` and
  `smoothstep()`, which are exactly 0 outside their reach, for anything standing in it;
- the shore plays as water too: ground under about 3 m high and gentle within 60 m of the
  sea (a beach), slopes over about 70 % within 70 m (cliffs), and the wet edge. Mown
  surfaces and bunkers win over it, which is how the beach on Lagoon Island plays as sand;
- so open ground that should be playable must stand 3 m or more above the sea;
- a rock over about 1.4 m high has a flat top that is playable rough, and the water drop
  can land a ball on it. The rocks in both sea holes are kept lower;
- the server needs Node 22.12 or later to load `sea.js` (`require` of an ES module).
  Below that the sea plays as the ground under it. `validateCourse` checks the sea is
  found when a hole expects one, and that none is found when it does not.

## Authoring helpers (`tools/arcade-holes/lib.js`)

| Group | Functions |
| --- | --- |
| Shapes | `rect`, `ellipse`, `blob` (ellipse with a seeded wobble), `capsule(line, width)` (a fairway along a curve; one width, one per control point, or a function), `ring` (a moat or collar as wedge pieces), `radiusOf` (a polygon's radius by angle, for `ring`), `arc`, `spline` |
| Polygon tools | `offsetPolygon`, `smoothPolygon`, `roundCorners(poly, radiusM)` (rounds a hand-typed outline's corners and leaves its edges where they were typed; `smoothPolygon` cuts a quarter off every edge, far too much on a large shape), `convexHull`, `signedDistance` (positive inside), `distToPolyline`, `pointInPoly`, `polygonArea`, `bbox`, `translate`, `ensureCCW` |
| Heights | `fbm` (seeded noise), `bump` (a mound that is exactly 0 outside its radius), `plateauWeight` (1 inside a polygon, fading outside), `plane` (a tilted level), `smoothstep`, `lerp`, and the `Heightfield` class: `fill`, `add`, `hill`, `valley`, `ridge`, `plateau`, `noise`, `smooth`, `toElevation`, `sampler` |
| Big relief | `tiers([{ poly, level, cliffM }], { warp })` (stacked plateaus with cliffs between: `apply(x, y, h)`, `cliff(x, y)` 0..1 on a face, `on(x, y)`; `level` may be a `plane()` or any function, which makes a ramp), `ridged` (noise with sharp crests), `strata(h, stepM, sharp)` (rock bands cut into a face), `nearField(poly, reachM)` (`signedDistance` with a bounding-box early out, for big grids), `awayFrom(polys, nearM, farM)` (a 0..1 mask that keeps noise and rocks off mown ground) |
| Trees and props | `scatterTrees(poly, { spacing, avoid })`, `clusterTrees(x, y, { count, radius })`, `prop(kind, x, y, { heightM, rotDeg })`, `facing(x, y, tx, ty)` (the `rotDeg` that turns a prop at `x, y` to face `tx, ty`) |
| Courses | `normalizeStage`, `normalizeRoutes`, `assembleCourse`, `validateCourse`, `writeCourse`, `findCourseSea`, `arcadeSource` |
| Catalogue (`courses.js`) | `COURSES`, `STAGES`, `FAILED`, `buildCourse(id)`, `buildCatalogue()` (builds and validates each course on its own: `{ built, failed }`), `tourManifest(built)`, `writeTourManifest`, `loadCatalogue(dir)` |

`validateCourse` uses the loader's own code (`makeSurfaceLookup`, `boundaryProblem`,
`makeTerrain`, the sea finder), so it fails on what would really go wrong: wrong version,
an identity the server refuses, a pin off its green, a boundary the loader would ignore,
a surface outside the height grid, a green steeper than 3 %, a fairway steeper than 20 %,
water above the ground beside it, a badly placed prop (below), a missing or unintended
sea. `writeCourse` validates, then writes `<dataDir>/courses/osm-node-<id>.json` through
a temporary file. That file name is the one the cache, the picker and the enricher key
on; a friendlier name would be duplicated the first time anything saved the course.

### Props

`L.prop(kind, x, y, { heightM, rotDeg })`. The look stream models every kind in
`PROP_KINDS` (a kind outside it is only a warning: "has no model yet"):

`lighthouse`, `palm`, `volcano`, `rock-arch`, `cactus`, `mesa`, `pine`, `snowman`, `cabin`,
`ice-spire`, `lava-rock`, `lava-fall`, `sakura-tree`, `torii`, `pagoda`, `stone-lantern`,
`bridge`, `temple`, `idol`, `pyramid`, `obelisk`, `sphinx`, `skyscraper`, `neon-sign`,
`billboard`, `grandstand`, `floodlight`, `target-ring`, `balloon`, `blimp`, `windmill`,
`shipwreck`, `crystal`, `torch`, `flag-banner`,

and the second wave (set pieces and life): `waterfall`, `castle`, `dragon`, `giant-tree`,
`ruins`, `jumbotron`, `fireworks`, `cloud`, `airship`, `statue`, `fountain`, `tiki`, `hut`,
`boat`, `gate`, `tower`, `rock-spire`, `launch-ramp`, `crowd`, `bird-flock`.

`heightM` is the model's real height and `rotDeg` turns it clockwise seen from above
(0: as modelled, front to the south), with these exceptions, which `validateCourse` knows:

| Kind | `heightM` means | Where it may be |
| --- | --- | --- |
| `target-ring` | its **diameter**: it lies flat on the ground | anywhere, the green and the pin included (put several concentric ones on a tiebreak pin) |
| `bridge` | its **length**, along the `rotDeg` heading (0 north, 90 east) | over water, sand, fairway and the line of play; not on a green or a tee |
| `balloon`, `blimp`, `fireworks`, `cloud`, `airship`, `bird-flock` | the model's height; they float (`FLOATING_PROP_KINDS`: the look stream lifts them) | anywhere |
| `crowd` | its height; it is **four times as wide** as that (`WIDE_PROP_KINDS`), across its facing: east to west at `rotDeg` 0 (`widePropSpan(p)` gives its two ends) | every part of its width on rough or out of bounds (not water, not mown ground, not sand) and 8 m from the line from tee to pin |
| every other kind | the model's height | on rough, out of bounds or in water; never on a green, tee, fairway or bunker, and at least 8 m from the straight line from tee to pin (5 m for the slim kinds in `SLIM_PROP_KINDS`, `tiki` among them) |

Water is allowed (a wreck in the bay, rocks in the lava) because a ball there is gone
anyway; fairways and bunkers are not, because a ball could come to rest inside the model.

### Routes

Every match stage has three distinct, visible ways to play it (contract section 5): a SAFE
one (wide, longer, no forced carry), a RISKY one (a carry or a gap that saves a shot when it
comes off) and a ROCKET one (a target only a boosted ball reaches). A hole file documents
them:

```js
hole: {
  par: 3, name: 'Sky Fortress', line: [TEE, PIN], note: '...', greenNote: '...',
  routes: [
    { id: 'safe', name: 'The Siege Ramp', note: 'Up the scree a pitch at a time, by the Rampart ledge half way.' },
    { id: 'risky', name: 'The Bastions', note: '...' },
    { id: 'rocket', name: 'Storm the Keep', note: '...' },
  ],
},
```

`normalizeRoutes` checks them (an id of `ROUTE_IDS`, a name, a note) when the hole is placed,
and they are carried to `course.holes[0].routes`. `validateCourse` insists that a match stage
which documents its routes has all three; a tiebreak arena may document fewer (or none).
`test/arcade-holes.test.js` requires them of every match stage, and `build.mjs` prints them.

### Aiming: 45 degrees and no more (read this before building anything tall)

The game lets a player aim 45 degrees either side of the flag and no further
(`Game.setAimOffset`). So a ball lying at the foot of a wall with the flag beyond it can never
be played out: every direction it may be aimed in is the wall. Two rules follow, and the
extreme stages are built on them:

1. **Every climb a ball might have to make is a slope it can stop on**, running up toward
   the flag: rough at 42 % or so. (Measured: rough holds a ball on 50 % and not on 100 %;
   fairway holds on 20 % and not on 30 %.) A level ledge half way up is a landing zone, not
   a step: a wall of even 12 m cannot be pitched over from its own foot.
2. **Every cliff drops into a hazard that reaches up it to its lip.** Draw the water (lava,
   ice) polygon right up the face to the top edge, and let the ground fall to the water
   level INSIDE the polygon, starting 2.5 m in (so the outline itself is level ground:
   `h = lerp(h, 0, clamp((insideM - 2.5) / 3, 0, 1))`). A ball that goes over the edge is
   then in the hazard at once and is dropped back on top, on the flat; and the renderer,
   which carves every water polygon down to its bed, draws the cliff sheer. Where there is
   no hazard to drop into, draw the out-of-bounds line along the crest (Summit Express's
   aretes): out of bounds is dropped where the ball left, on the crest.

Also: a first target must be within about 35 degrees of the flag as seen from the tee, or
it cannot be aimed at (Dragon's Spine's Ash Road).

## Adding a stage

1. Copy one of `tools/arcade-holes/holes/*.js` to `holes/<id>.js`. A hole exports:
   - `id` (the file's name), and `extent` (the rectangle its ground covers);
   - `stage` (above), with a `number` no course has ever used: it is the course's identity
     for good (saved rounds, cache entries and HD bundles are keyed by it);
   - `hole: { par, name, line, note, greenNote }`, with the tee as the line's first point;
   - `surfaces`, `trees`, `props`;
   - `obLine`: where a ball is out. The tool draws `boundary` 15 m inside it;
   - `height(x, y)`: the ground, in metres. For a sea hole, the sea is 0;
   - `sea: true | false`: whether the terrain is meant to hold a sea;
   - `probes: [{ at, kind, what }]`: spots that must play as a given surface.
   That is all: `courses.js` finds the file. (A hole file without a `stage` is not a
   course of its own; it can still be a piece of a larger one, as in Arcade Classics.)
2. `node tools/arcade-holes/preview.mjs --only <id>` and look at the map, then
   `node tools/arcade-holes/build.mjs --check --only <id>`.
3. Playtest it: build into a private data dir, start a private server, load the course
   and fire `POST /api/test-shot` swings (the contract's ground rules give the ports).
4. Add the hole's own tests. `test/arcade-holes.test.js` already checks every stage
   generically (it builds, validates, has the contract's `course.arcade`, a unique number
   and order, a green of the contract's size, props of known kinds, and is in the manifest).

Design rules: built for real swings by average golfers (and see "Aiming: 45 degrees and no
more" above before building anything with a wall in it). Greens at least 28 x 24 m
(tiebreak greens 34 m and more across) on a plane under 3 %; fairways 40 m and wider where
drives land; a safe line and a hero line on every hole; hazards that are seen from the
tee and cost a stroke rather than a lost ball; out of bounds far enough away that a
reasonable miss never finds it. Give a hole plenty of props: they carry the theme.

holes-c's three stages, as built and playtested:

- **Pharaoh's Gate** (par 4, 304 yd round the left fairway, 269 yd straight). The Great
  Sand Sea lies on the direct line from 128 to 208 yd and ends in the Gate Pool (water,
  208 to 233 yd). A drive of about 146 mph or more carries both and runs onto the green;
  a stock 3-wood or hybrid at the flag is wet, an iron is in the sand. Left fairway 48 m
  wide (safe), right fairway 36 m (shorter, the oasis beyond it catches a 20 degree slice).
- **Midnight Mile** (par 5, 548 yd, 542 straight). Rooftop tee, a 60 m boulevard, the
  canal 28 m wide all down the left, opening into a basin short left of the green. The
  straight line from tee to flag is mown and dry all the way (the basin's quay is 12 m
  left of it), so a Rocket drive at the flag (about 500 yd of carry) finishes on the green
  and weaker Rocket swings finish short and dry. A stock drive and 3-wood reach the green.
- **Thunder Dome** (par 3, 140 yd, tiebreak). A stadium bowl with a mown floor and a
  40 x 37 m green at 0.9 %. No water; the bank feeds a wide ball back; out of bounds only
  behind the stands, so even a driver stays in play. Rings at 3, 7, 12 and 18 m from the pin.

### The extreme stages (rocket holes)

Three extra stages, `order` 10 to 12, each `freeBall: 'rocket'`: the hero target is reached
by the stage's free Rocket ball and by nothing else. Numbers are ball speeds through the real
`Game` with the arcade layer's Rocket, a stock launch (13 degrees, 2600 rpm) unless said, in
still air unless said; all of it is in `test/arcade-holes-x.test.js`. A plain drive rises
30 m at most; a Rocket at 125 mph rises 80 m and carries 370 yd on the level.

- **Sky Fortress** (canyon, par 3, 427 yd, the green 50 m above the tee, wind 8 to 18 mph).
  A butte in a flooded gorge, sheer into the water on every side but the south, where the
  Siege Ramp (200 m of scree at 42 %, the Rampart ledge half way up it) runs straight at the
  tee. The Rocket carries the 288 m to the lip from about 118 mph: 125 mph finishes in the
  courtyard 35 yd short of the flag, 130 to 140 on the green, 150 and more in the sand or the
  rough behind it, under the keep. Into 18 mph, 125 mph still makes the top. Short lands on
  the ramp and stays (100 mph: home in 4 or 5 with plain balls); 12 degrees wide holds a
  bastion, 12 m below the top; wider is the lake, a stroke, dropped on the last land flown
  over. A plain drive finishes on the upper ramp. ROCKET: the flag. SAFE: the ramp, a pitch
  at a time. RISKY: the bastions, which hold a wide one but only just.
- **Dragon's Spine** (volcano, par 4, 604 yd, wind 6 to 15 mph). Over 190 m of lava and 45 m
  up onto the Spine, the fairway along the crater's south rim (296 m to its lip); the green
  is in the caldera beyond, 39 m below. The Rocket makes the Spine from about 118 mph (into
  15 mph: 125); 125 mph leaves 200 yd down to the flag, 140 mph 145 yd, 155 mph 100 yd, and
  from about 165 mph the ball runs off the Spine's end and down the crater wall toward the
  green. Short lands on the scree between the Jaw (a ledge 190 m out, 14 m above the tee:
  a 152 mph PLAIN drive just reaches it) and the lip. Left is lava (dropped on the Spine's
  or the Jaw's edge, or back by the tee); right is the Ash Terrace, dry. SAFE: the Ash Road,
  32 degrees right of the flag from the tee, up the slope to the Ash Terrace, a pitch up the
  crater's low south-east rim and one down: home in 5 to 8. RISKY: from the Ash Terrace one
  wood over the low rim at the flag.
- **Summit Express** (alpine, par 5, 700 yd, the green 70 m above the tee, wind 10 to 22
  mph). Up the headwall (snow at 42 %, the Shoulder ledge on it) into a hanging valley 44 m
  above the tee, 260 m to its lip: the Rocket makes it from about 108 mph, and from 120 mph
  into a 22 mph headwind. 125 mph finishes 300 yd from the flag, 140 mph 240 yd; the biggest
  stop at the foot of the bank up to the Bench, or on it with the wind behind. From the
  Bench it is 48 m of crevasse (ice, to its lips: short is a stroke, dropped back on the
  Bench) straight at the flag: RISKY; or the West Col, the bank left of the crevasse's head:
  SAFE. The two aretes feed a ball 12 degrees wide back into the valley; over an arete is
  out of bounds, dropped on its crest.

Several holes on one course: give each piece a `dx, dy` (and `dz`) and a `base(x, y)` for
the ground between them. Each piece blends into the base over 30 m inside its own extent,
so keep a hole's features that far from its extent's edge.

## What the integrator needs to know

0. **The tour.** `arcade-tour.json` in the data dir is the list of stages. Props that face
   something (grandstands, billboards, neon signs, the sphinx) were turned with
   `L.facing`, which assumes a model's front is glTF +Z (south at `rotDeg` 0).
1. **`course.props` and `course.arcade` reach the browser** through `courseGeometry()` in
   `server.js` (`props` and `arcade` in `GET /api/course-geometry`): the props layer reads
   the first, the look reads `arcade.theme` and `arcade.timeOfDay`.
2. **Boot course.** With no `BIRDIE_NO_AUTOLOAD`, the server loads the first cached file by
   name. `osm-node-99...` sorts ahead of every `osm-relation-` and `osm-way-` file, so
   Lagoon Island becomes the course the app opens on. Decide whether that is wanted.
3. **Identity is borrowed.** Arcade courses pose as OpenStreetMap nodes. A real `arcade:`
   id would need changes in `lib/course-identity.js` (`normalizeCourseSource`,
   `courseCacheStem`), `lib/course-activation.js` (`resolvedPublicPackage`),
   `lib/course-fingerprint.js` (`COURSE_ID`), `lib/course-cache.js` (`KEY`) and
   `lib/course-library.js`. Not needed for v1.
4. **The look is the real-course look.** Canyon Run is green parkland with oaks, not red
   rock with cacti, and the trees on Lagoon Island are broadleaf. The arcade look preset
   and the props carry the theme. To dry a course out, add its name and id to `COURSE_DRY`
   and `COURSE_IDS` in `public/render/course-character.js` and the mirrored tables in
   `lib/tree-obstacles.js` (a test keeps the two in step).
5. **Horizon trees stand in the sea** on a course with no canopy trees: the renderer's
   invented tree band skips water polygons but not the sea. Arcade courses always carry
   `canopy.trees`, which switches the band off, so a hole needs at least one tree. A real
   fix is a `seaAt` test in `_horizonSpots` (`public/render/scene.js`).
6. **Out of bounds inside a course is not possible** with polygons: `ob` is not in
   `PRIORITY` in `lib/course.js`. Canyon Run's walls are out only because the boundary is
   drawn up them. Adding `'ob'` to the front of `PRIORITY` would make `ob` polygons work.
7. **Low graphics.** With `RENDER_CONFIG.water` off, a water polygon is drawn at the
   height of its lowest corner, not its median interior, so Canyon Run's gorge would
   fill to the rim. The default water path draws it at the gorge floor.
8. **Wind.** Conditions belong to the day, not the course. Lighthouse Point asks for wind
   through `course.arcade.conditions: 'windy'`; the match layer has to apply it
   (`game.setConditions`).
9. **Node version.** On Node 22.0 to 22.11 the server cannot find the sea, and the two sea
   holes would play as dry ground. `package.json` allows Node 22 and up; Electron is fine.
