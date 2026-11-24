# The Sim Clash website

A static site for GitHub Pages: plain HTML, one stylesheet, one small script. No framework,
no build step, no external requests (no CDN, no fonts to fetch, no analytics). It is served
from `https://<owner>.github.io/sim-clash/`, so every path in it is relative.

`.github/workflows/pages.yml` publishes this folder on every push to `main` that touches it
(and by hand from the Actions tab). One-time setup: repository Settings > Pages > Source:
**GitHub Actions**.

## Set these before the first publish

Everything that depends on where the project lives is in **`config.js`**:

| Key | What to put there |
| --- | --- |
| `owner` | The GitHub account or organisation. It ships as the placeholder `OWNER`. |
| `repo` | The repository name (`sim-clash`). |
| `branch` | The default branch, for links to files in the tree (`main`). |
| `downloadUrl` | A direct link to the installer for the Download buttons. Empty: they go to the repository's latest release page. |
| `bridgeUrl` | The project page of Open Connect Bridge, which the Foresight chain on the Connect page needs. Empty: the bridge is named but not linked. Check that the address opens for someone who is not signed in to GitHub before you set it. |

`site.js` fills every `<a data-gh="...">` (repository, releases, issues, licence, files in
the tree) and every `data-fill` text (the `git clone` line) from it. Without JavaScript
those links fall back to the Install and Contribute pages.

One thing `config.js` cannot do: link previews. `og:image` is `assets/og.jpg`, relative,
and most scrapers want an absolute address. Once the site has its real address, change
that one `<meta property="og:image">` line in each page to the full URL.

## Pages

| File | What |
| --- | --- |
| `index.html` | Home: hero, what it is, the stage gallery, match rules, balls and tricks, camera and sound, credits |
| `install.html` | The Windows installer (and the SmartScreen warning), running from source |
| `connect.html` | Open Connect, port 921, the launch monitors tier by tier (generated from `lib/launch-monitors.json`), the Foresight GC chain, test swings |
| `play.html` | Starting a match, formats, rules, the match menu, balls and tricks, keys, camera |
| `faq.html` | Questions and troubleshooting |
| `contribute.html` | The repository, how holes are authored, adding a stage |
| `assets/site.css`, `site.js`, `config.js` | The look, the link filler and the hero clip, the settings above |

The header and the footer are repeated in each page (there is no build step to share them):
a change to the navigation is a change in six files.

## Keeping it true to the game

The stage cards and the ball lists are generated from the game's own data, between
`<!-- gen:NAME -->` and `<!-- /gen:NAME -->` markers:

```
node tools/arcade-holes/build.mjs     # or npm run prepare:arcade-data
node site/dev/refresh.mjs             # rewrites the marked parts of the pages
```

It reads `arcade-tour.json` and the stage course files (name, par, yards, blurb, wind, free
ball, the three routes), `POWERUPS` in `lib/arcade.js` (balls and tricks) and the theme
colours in `public/arcade/match.js`. A new stage shows up as a card with a colour gradient
until it has a picture: put an 800 x 450 WebP at `assets/stages/<stage id>.webp` and add
its alt text to the `ALT` table in `refresh.mjs`.

Everything else is written by hand from the docs in the tree (`docs/match.md`,
`docs/arcade.md`, `docs/arcade-holes.md`, `docs/arcade-feel.md`, `docs/arcade-voice.md`,
`docs/arcade-v2.md`, `docs/foresight-bridge.md`, `lib/openconnect.js`) and from the game's own menus
(`public/arcade/shell.js`, `shell-core.js`). When a rule changes there, change the page.
The Connect page only names hardware the project has a source for; keep it that way.

## Pictures

All of them are captures of the game itself.

| Folder | What | How it was captured |
| --- | --- | --- |
| `assets/stages/` | One 800 x 450 picture per stage | The game's 3D view through its free camera, no interface |
| `assets/shots/` | The hero still and the hero clip (a silent animated WebP of the ball cam on Sky Fortress, 8 s), flights and views | The game's 3D view, no interface |
| `assets/hud/` | Screens with the interface: title, main menu, solo, settings, match setup, VS, turn banner, callout, loadout, match menu, test swings, winner | A private game server and a headless browser at 1600 x 900, the way `tools/release/screenshots.mjs` does it. `stage-intro` is `docs/media/stage-intro.jpg` |
| `assets/og.jpg`, `icon.svg`, `icon-180.png` | Link preview, favicon (from `docs/media/icon.*`) | |

When the game's screens change, re-shoot the ones in `assets/hud/`: a site that shows last
month's menus reads as abandoned. Keep new pictures small: WebP, 1280 px wide at most for a
screenshot, lazy-loaded (`loading="lazy"`) below the first screen. The home page is about
3 MB with everything loaded, half of it the hero clip, which is fetched only after the page
is up and not at all for visitors who ask for reduced motion or data saving.

## Looking at it locally

Any static file server pointed at this folder works, for example one of:

```
npx http-server site -p 8080
python -m http.server 8080 --directory site
```

then open `http://localhost:8080/`.
