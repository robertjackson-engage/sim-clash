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
  Casino Audio, Digital Audio, RPG Audio): CC0 1.0. Interface sounds, impacts, coins.
- **[freesound.org](https://freesound.org)** recordings, each one checked as Creative
  Commons 0 on its own page: the crowd (a session recorded by ShangusBurger), golf strikes,
  the cup, water, whooshes, timpani, rockets. CC0 needs no credit; the authors are named in
  the table anyway.
- **Seven stings and jingles** (fanfares, the stage sting, the turn chime) were generated
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
  `tools/arcade-art/bake.mjs` turns the export into the small game models.
- **Generated with image-to-3D** from this project's own concept and reference images
  (`docs/art/`), then reduced with `tools/arcade-art/fit-glb.mjs`: dragon, giant tree,
  shipwreck, sphinx and temple (made with [Meshy](https://www.meshy.ai)), and the first four
  landmarks (lighthouse, volcano, rock arch, palm).

The concept paintings in `docs/art/concepts/` were generated for this project as a style
guide. No model, texture, layout or name is taken from another game.

## Skies and textures (from Open-Birdie)

CC0, listed in `ASSETS.md`: the sky HDRI, tree bark and leaf atlases and bunker sand from
[Poly Haven](https://polyhaven.com), grass from [ambientCG](https://ambientcg.com).

Three sky photos ship with the game, all from Poly Haven, all
[CC0 1.0](https://polyhaven.com/license) (public domain: no credit is required, and they
are named here anyway). The midday sky is inside the app, as in Open-Birdie. The other two
are installed with the stages (`resources/arcade-data/sky/`, copied into the player's
`sky-cache` on the first start), because the game itself never downloads anything:

| Sky | Lights | Authors | Source |
| --- | --- | --- | --- |
| Kloofendal 48d Partly Cloudy (Pure Sky), `public/assets/hdri/puresky_4k.hdr` | the midday stages, and the fallback | Poly Haven | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky |
| Kloppenheim 06 (Pure Sky), `kloppenheim_06_puresky_4k.hdr` | the golden-hour stages and the tropical ones (Lagoon Island, Canyon Run, Temple Run, Pharaoh's Gate, Sky Fortress, Bullseye Bay, Ice Pick) | Greg Zaal (original), Jarod Guest (sky edits) | https://polyhaven.com/a/kloppenheim_06_puresky |
| Rustig Koppie (Pure Sky), `rustig_koppie_puresky_4k.hdr` | the daytime stages (Lighthouse Point, Frostbite Ridge, Sakura Garden, Summit Express) | Greg Zaal (original), Jarod Guest (sky edits) | https://polyhaven.com/a/rustig_koppie_puresky |

Both installed files are the unmodified 4k `.hdr` downloads; their checksums are pinned in
`tools/arcade-holes/sky-files.mjs`. The dusk, night and volcano skies (Volcano Drop,
Dragon's Spine, Midnight Mile, Thunder Dome) are painted by the game's own code
(`public/render/arcade-sky.js`) and use no photo.

## Stages

The fifteen stages (twelve match holes and three sudden-death arenas) are original designs,
written as code in `tools/arcade-holes/holes/`. They are fictional places.
