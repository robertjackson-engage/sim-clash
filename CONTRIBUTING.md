# Contributing to Sim Clash

Thanks for wanting to help. Sim Clash is a small open-source project; anything that makes
the game work on more launch monitors, play better or look better is welcome.

## The most useful things right now

1. **Tell us what happened with your launch monitor.** It has been played on very few
   setups. Open an issue with the "Launch monitor report" form, whether it worked or not.
2. **Play a match and report what felt wrong.** `docs/arcade-v2.md` lists the rough edges
   that are already known.
3. **Fix something from that list**, or from the issues.

## Getting set up

You need Node.js 22 or newer (older versions run zero tests and report success) and Git.

```
git clone https://github.com/robertjackson-engage/sim-clash.git
cd sim-clash
npm install
npm start
```

Useful while developing:

| Command | What |
| --- | --- |
| `npm test` | every test (`node --test`); it must stay green |
| `npm run start:server` | the server alone; open `http://localhost:8222` |
| `npm run arcade:holes` | rebuild the stages into `data/` after editing a hole |
| `npm run shot` | send a fake launch-monitor shot over real TCP |
| `npm run pack` then `npm run verify:package` | build the Windows app and check it |

There is no hot reload: restart the server after changing `server.js` or `lib/`, reload the
page after changing `public/`.

**A private test instance.** To run a second copy without touching your own game (its
ports, its players, its coins), give it its own ports and data folder:

```
BIRDIE_PORT=8301 BIRDIE_OC_PORT=9931 BIRDIE_DATA_DIR=.scratch/me/data BIRDIE_ENRICH=0 BIRDIE_SKY_PREFETCH=0 node server.js --bundled-arcade
```

(PowerShell: set each with `$env:NAME = 'value'` on its own line first.) Open the page with
`?sound=0` when you do not want it to make noise. Simulated swings:
`POST /api/test-shot {"speed":150,"vla":13,"hla":0,"spin":2600,"spinAxis":0}`.

## Where things are

| You want to change | Look in | Read first |
| --- | --- | --- |
| A stage, or add one | `tools/arcade-holes/holes/` | `docs/arcade-holes.md` |
| Balls, tricks, grading, coins | `lib/arcade.js` | `docs/arcade.md` |
| Match rules | `lib/match.js` | `docs/match.md` |
| Match screens, lobby | `public/arcade/match.js`, `match.css` | `docs/match.md` |
| The HUD, banners, ball dock | `public/arcade/arcade.js`, `arcade.css` | `public/arcade/INTEGRATION.md` |
| Sound and the announcer | `public/arcade/audio.js`, `tools/arcade-voice/` | `docs/arcade-voice.md` |
| The arcade look, prop models | `public/render/arcade-look.js`, `props.js`, `tools/arcade-art/` | `docs/arcade-look.md` |
| Camera and slow motion | `public/arcade/feel.js`, `public/render/flight-camera.js` | `docs/arcade-feel.md` |
| Launch monitor input | `lib/openconnect.js` | the README's connection section |
| Packaging, the installer | `build/electron-builder.cjs`, `tools/release/` | `docs/dev/packaging.md` |
| The product's name | `public/product.json` | `docs/dev/rename.md` |

Everything under `docs/` is indexed in `docs/README.md`.

## Ground rules

- **Tests.** Add tests for what you build and keep `npm test` green. Say in the pull request
  what you ran and what you saw. "Not tested on a real launch monitor" is a fine thing to
  say; claiming a check you did not make is not.
- **Small changes.** One thing per pull request. Match the style of the file you are in.
- **Shared engine files.** `server.js`, `public/app.js`, `public/index.html`, `main.js` and
  most of `lib/` and `public/render/` come from Open-Birdie. Keep edits there small and
  additive, and mark them with a `// v2:<area>` comment, so that Open-Birdie's updates keep
  merging (`docs/dev/upstream.md`). If a fix belongs in the engine itself, consider sending
  it to Open-Birdie.
- **The feel rules.** These came from playing it and are not up for casual change: no
  looping or continuous sound; no shot clock; slow motion only when the ball comes by the
  pin; the camera follows the ball and never flips; good shots look like rockets.
- **Assets.** Only add sounds, models, images or fonts that are CC0, that you made, or that
  were generated for this project, and add them to the credits (`CREDITS.md`, and for sounds
  `tools/arcade-voice/sources.mjs`, which writes `public/arcade/sfx/CREDITS.md`). Nothing
  from a commercial game, a film or a broadcast. No real course layouts, no real brands.
- **Names.** Do not use another game's or company's name as if this project were connected
  to it, in the game, the docs or the site.
- **No secrets, no personal paths.** Keys go in `.env` (git-ignored). Do not commit
  `data/`, `.scratch/` or paths from your own machine.

## Licence

By contributing you agree that your contribution is released under the MIT licence of this
project (see `LICENSE`).
