# Credits

Sim Clash stands on a lot of other people's work. Thank you.

## Built on Open-Birdie

- **Rooj Rin** ([rroojrooj](https://github.com/rroojrooj)) wrote
  [Open-Birdie](https://github.com/rroojrooj/Open-Birdie), the open-source golf simulator
  this all started from: the ball-flight physics, the course engine, the Three.js renderer,
  the GSPro Open Connect listener and the desktop app. MIT licence.
- **jordan-shilts** maintains the
  [fork](https://github.com/jordan-shilts/Open-Birdie) Sim Clash is based on, and added
  terrain, real courses, HD rendering, skies, impact effects and a great deal more. MIT licence.

Sim Clash adds an arcade game on top (stages, match play, power-up balls, callouts, an
announcer, menus) and puts the simulator away. To pull their newer work into this project
see `docs/dev/upstream.md`. If you want a golf simulator with real courses, use Open-Birdie.

## Software

| Package | Licence |
| --- | --- |
| [three.js](https://threejs.org) | MIT |
| [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) | Apache-2.0 |
| [pngjs](https://github.com/pngjs/pngjs) | MIT |
| [Electron](https://www.electronjs.org) | MIT (Chromium: BSD and others) |
| Build only: [electron-builder](https://www.electron.build) (MIT), [sharp](https://sharp.pixelplumbing.com) (Apache-2.0), [esbuild](https://esbuild.github.io) (MIT) | |

The game uses system fonts only (Bahnschrift, Segoe UI and their fallbacks). No font or
icon set is bundled: every icon in the interface is drawn in the page as SVG or CSS.

## Sound effects

All sound effects are CC0 recordings or were generated for this project.
`public/arcade/sfx/CREDITS.md` lists every shipped file with its source, link, licence and
original file name. In short:

- **[Kenney](https://kenney.nl)** audio packs (Interface Sounds, UI Audio, Impact Sounds,
  Casino Audio, Digital Audio, RPG Audio, Sci-Fi Sounds): CC0 1.0. Interface sounds,
  impacts, coins, and layers of the gadget sounds.
- **[freesound.org](https://freesound.org)** recordings, each one checked as Creative
  Commons 0 on its own page: the crowd (a session recorded by ShangusBurger), golf strikes,
  the cup, water, whooshes, timpani, rockets. CC0 needs no credit; the authors are named in
  the table anyway.
- **Eleven stings and jingles** (fanfares, the stage sting, the turn chime) were generated
  from text prompts with ElevenLabs Music. No reference audio was used.

## Announcer voice

The announcer's lines are synthetic speech, generated with ElevenLabs text-to-speech (a
stock preset voice: no voice cloning, no real person imitated) from the script in
`tools/arcade-voice/lines.mjs`. The clips are in `public/arcade/voice/announcer/`.

To replace the voice, record or generate your own clips with the same file names (the
manifest in that folder lists them), or make a new pack beside it: `docs/arcade-voice.md`
explains the tools. Player names are not shipped. With your own ElevenLabs key
(`.env.example`) the game can render a name once and keep it; without one the announcer
says "PLAYER ONE" and "PLAYER TWO".

## 3D models

All prop models in `public/arcade/props/` were made for this project:

- **Modelled by script in Blender** (pagodas, pyramids, grandstands, balloons, torii, the
  crowd and about forty more): the Python sources are in `tools/arcade-art/blender/`, and
  `tools/arcade-art/bake.mjs` turns the export into the small game models. The **stadium
  kit** of the second release is made the same way (`tools/arcade-art/blender/stadium.py`):
  `stand-section`, `stand-corner`, `led-board`, `ad-board`, `barrier`, `camera-tower`,
  `tunnel` and `podium`, with the rebuilt `crowd`, `grandstand` and `jumbotron`. The words
  on its boards and hoardings are the game's own name and made-up sponsors; no real brand,
  club, league or stadium is shown or copied.
- **Generated with image-to-3D** from this project's own concept and reference images
  (`docs/art/`), then reduced with `tools/arcade-art/fit-glb.mjs`: dragon, giant tree,
  shipwreck, sphinx and temple (made with [Meshy](https://www.meshy.ai)), and three of the
  first landmarks (lighthouse, volcano, rock arch).
- **Grown in code**: every tree and plant of the arcade worlds (`public/arcade/trees/*.glb`:
  kapok, strangler fig, coconut, date and fan palms, spruce, fir, larch, cherry, maple, pines
  and the rest, each with a higher-detail "hero" model for the trees by a tee or a green) is
  built from seeds by `tools/arcade-art/trees/gen.mjs`. The `palm` prop
  (`public/arcade/props/palm-a.glb`, `-b`, `-c`) is that generator's coconut palm.

- **Drawn by the game's own code, with no model or picture file at all**: the 25,000
  spectators of a stadium (`public/render/crowd.js`: one instanced figure, dressed and
  animated in the shader), the beams, flares and confetti (`stadium-fx.js`), the sixteen
  kinds of course gadgets (`public/render/gadgets.js`: rings, pads, strips, fans, geysers,
  bumpers, rails, walls, funnels, a pipe, a cannon, coins), and the living world's cast
  (`public/render/world-models.js`: trains, cars, a cable car, camels, birds, fish, koi,
  dolphins, a whale, turtles, walkers, windmills, windsocks, pennants and the rest; a boat,
  a balloon and an airship under way reuse the prop models above).

The concept paintings in `docs/art/concepts/` were generated for this project as a style
guide. No model, texture, layout or name is taken from another game.

## Skies and textures (from Open-Birdie)

CC0, listed in `ASSETS.md`: the sky HDRI, tree bark and leaf atlases and bunker sand from
[Poly Haven](https://polyhaven.com), grass from [ambientCG](https://ambientcg.com).

One sky photo ships with the game: the midday sky inside the app, as in Open-Birdie. It is
from Poly Haven under [CC0 1.0](https://polyhaven.com/license) (public domain: no credit is
required, and it is named here anyway), and it is what the game falls back to when a
stage's own sky cannot be loaded:

| Sky | Lights | Authors | Source |
| --- | --- | --- | --- |
| Kloofendal 48d Partly Cloudy (Pure Sky), `public/assets/hdri/puresky_4k.hdr` | the fallback sky, and the original simulator's midday | Poly Haven | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky |

The two Poly Haven photos that used to be installed with the stages (Kloppenheim 06 and
Rustig Koppie, both Pure Sky, by Greg Zaal with sky edits by Jarod Guest, CC0) no longer
ship: no stage is lit by them now. The original simulator (`BIRDIE_PRODUCT=open-birdie`)
still downloads them from Poly Haven the first time its Sky button picks them, as
Open-Birdie does (`ASSETS.md`); their checksums stay pinned in
`tools/arcade-holes/sky-files.mjs`.

## The trees' leaves and bark (generated for this project)

The trees are drawn with four textures in `public/arcade/trees/`: a painted leaf atlas
(`leaves.webp`, twenty tiles: broadleaf clusters, palm frond, fan palm, banana leaf, fern,
spruce bough with and without snow, pine needles, cherry blossom, maple, acacia, juniper,
gorse, dry scrub, flowering bush, grass, vines, bare twigs), its masks (`leaves-aux.png`),
eight bark columns (`bark.webp`: rough broadleaf, flaky conifer, smooth kapok, palm rings,
cherry with lenticels, date palm, charred wood, mossy jungle bark) and their normal map
(`bark-n.webp`). Each tile was painted by an image model (Nano Banana 2.1, through
[Higgsfield](https://higgsfield.ai)) from a written description of the plant alone, on a
flat background; this project then cut it out, cleaned its edges, sorted leaf from twig from
flower, made the bark tile, and derived the normal maps
(`tools/arcade-art/trees/textures.mjs`). The prompts are in
`tools/arcade-art/trees/prompts.mjs` and the job ids in
`public/arcade/trees/manifest.json`. No photograph, texture library, artist or other game
was used or named.

## The stages' skies and ground (generated for this project)

Every stage is drawn under its own sky panorama and on its own ground materials, in
`public/arcade/env/`: eleven panoramas (`sky/*.webp`: tropical day, canyon sunset, links,
volcano dusk, alpine day and blue hour, sakura dawn, jungle, desert sunset, a neon night
city, a stadium night) and eight tiling ground sets (`tex/*_c.webp`, `*_n.webp`: grass,
rough, sand, rock, snow, basalt, ice, earth). All of it was generated for this project with
an image model (Higgsfield, `nano_banana_2_1`) from prompts written for it, and processed
by this repository's own tools (`tools/arcade-art/env/`: the seam closed, the horizon and
sun found, tiles made to wrap, heights and normals derived). No photograph, texture
library or third-party picture is in it; the skylines and landscapes in the panoramas are
invented and stand for no real place or building. `public/arcade/env/manifest.json`
lists every file with its checksum, the model, the job id and the prompt
(`tools/arcade-art/env/prompts/`). The far ranges, islands, mesas and towers that stand in
front of a panorama, the drifting cloud and the dusk and night skies a stage falls back to
are drawn by the game's own code (`public/render/far-world.js`, `arcade-sky.js`).

## Stages

The fifteen stages (twelve match holes and three sudden-death arenas) are original designs,
written as code in `tools/arcade-holes/holes/`. They are fictional places.
