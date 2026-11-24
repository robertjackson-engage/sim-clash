# Notice

**Sim Clash** is free, open-source software released under the MIT licence (see `LICENSE`).

It is a fork. Most of the engine underneath the game was written by other people, and their
copyright and licence terms continue to apply to it:

| Work | Author | Licence | Where |
| --- | --- | --- | --- |
| **Open-Birdie**, the original golf simulator: physics, course engine, renderer, Open Connect listener, desktop shell | Rooj Rin | MIT, Copyright (c) 2026 Rooj Rin | https://github.com/rroojrooj/Open-Birdie |
| **Open-Birdie (fork)**, the actively developed fork this project is based on: terrain, courses, HD rendering and much more | jordan-shilts | MIT | https://github.com/jordan-shilts/Open-Birdie |
| **Sim Clash**: the arcade game (stages, match play, power-up balls, callouts, announcer and sound, prop models, menus, packaging) | Sim Clash contributors | MIT, Copyright (c) 2026 Sim Clash contributors | this repository |

The `LICENSE` file carries the original copyright line unchanged, with this project's line
beneath it. Sim Clash is an independent project: it is not affiliated with, endorsed by or
supported by the Open-Birdie authors. Please send Sim Clash bugs here, not to them.

## Third-party software shipped with the app

| Package | Licence | Used for |
| --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) | MIT | 3D rendering |
| [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) | Apache-2.0 | imported by the renderer (only active with a map-tiles key, which the game does not use) |
| [pngjs](https://github.com/pngjs/pngjs) | MIT | PNG decoding on the server |
| [Electron](https://github.com/electron/electron) | MIT; Chromium and its components under their own licences | the desktop window (`LICENSE.electron.txt` and `LICENSES.chromium.html` are installed beside the app) |

Each package's own licence file is included in the installed app. Build and development
tools (electron-builder, esbuild, sharp, ajv, geotiff, proj4, and the audio codecs under
`tools/arcade-voice`) are not shipped.

## Third-party and generated assets

Every asset is CC0, generated for this project, or authored for this project. Nothing is
taken from a commercial game, a film, a broadcast or a video. The full list, file by file
where it matters, is in `CREDITS.md`, `ASSETS.md` and `public/arcade/sfx/CREDITS.md`.

The installer carries one sky photograph (an HDRI) from [Poly Haven](https://polyhaven.com),
released under CC0 1.0, inside the app. The stages' own sky panoramas and ground textures
(`public/arcade/env/`) were generated for this project with an image model and processed
by this repository's tools; they contain no third-party picture. `CREDITS.md` names each
file's source.

## Names and trademarks

Sim Clash is not affiliated with, authorised by or endorsed by any launch monitor maker,
simulator vendor or game publisher. GSPro, Foresight, GCQuad, Uneekor, TrackMan, Garmin and
every other product name mentioned in this repository belong to their owners and are used
only to describe compatibility. The game implements the publicly documented GSPro Open
Connect interface for interoperability and contains no code or assets from those products.

`DISCLAIMER.md` (from Open-Birdie) applies to Sim Clash as well: swinging real clubs at
real balls indoors is at your own risk.
