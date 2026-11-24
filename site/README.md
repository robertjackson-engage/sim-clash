# The Sim Clash website

A static site for GitHub Pages: plain HTML, one stylesheet, two small scripts. No framework,
no build step, no external requests (no CDN, no fonts to fetch, no analytics). It is served
from `https://<owner>.github.io/sim-clash/`, so every path in it is relative.

`.github/workflows/pages.yml` publishes this folder on every push to `main` that touches it
(and by hand from the Actions tab), minus `dev/` and this file. One-time setup: repository
Settings > Pages > Source: **GitHub Actions**.

## The settings: `config.js`

| Key | What to put there |
| --- | --- |
| `owner` | The GitHub account or organisation. |
| `repo` | The repository name (`sim-clash`). |
| `branch` | The default branch, for links to files in the tree (`main`). |
| `downloadUrl` | A direct link to the installer. `dev/refresh.mjs` writes it into every Download button as a plain `href`, so the click downloads with scripts off; with scripts on, a click also opens the "Your download has started" panel (where the file is, the Windows warning, the T key). Empty: the buttons go to the repository's latest release page and there is no panel. Run `node site/dev/refresh.mjs` after changing it. |
| `downloadSize` | Optional. The installer's size as the panel shows it beside the file name ("about 190 MB"). |
| `youtubeUrl` | Optional. A YouTube address for the trailer. Empty: "Watch the trailer" plays `assets/video/trailer.mp4`. Set: the same button plays the YouTube video in the lightbox (requested only when a visitor presses it; the home page's Content-Security-Policy allows `youtube-nocookie.com` in a frame for exactly this). |
| `release` | The version the site describes (the What's new page, the strip on the home page). |

`site.js` reads it in the browser and fills every `<a data-gh="...">` (repository, releases,
issues, licence, files in the tree) and every `data-fill` text (the `git clone` line).
Without JavaScript those links fall back to pages of the site.

`dev/refresh.mjs` reads it too, for what a link preview or a search engine needs as plain
HTML: the absolute `og:image`, `og:url` and canonical address in every page's `<head>`, and
`sitemap.xml`. **After changing `owner`, `repo` or `release`, run `node site/dev/refresh.mjs`.**

## Pages

| File | What |
| --- | --- |
| `index.html` | Home: the hero (wordmark, the looping clip, Download / trailer / GitHub), why it was built, the worlds, a match in four beats, the front door, balls and tricks, what is new, launch monitors, Make it yours, credits |
| `whats-new.html` | The release: before / after sliders, what changed in the look, the stadium, the new features, the release notes (from `CHANGELOG.md` when it has an entry for `config.release`) |
| `install.html` | The Windows installer, SmartScreen, the firewall question, the first start, running from source |
| `connect.html` | How a launch monitor gets its shots to a game: Open Connect, port 921, the address to type, the launch monitors tier by tier and each one's own steps (generated from `lib/launch-monitors.json`), the Foresight bridge, test swings |
| `play.html` | Starting a match, formats, rules, putting, the match menu, drops and views, balls and tricks, gadgets, the other games, replays, solo and practice, settings, keys |
| `make-it-yours.html` | Adding a hole, a ball or a game mode with an AI coding assistant: where things live, three example requests checked against the code |
| `faq.html` | Questions and troubleshooting |
| `contribute.html` | The repository, how holes are authored, adding a stage, credits |
| `assets/site.css`, `site.js`, `config.js`, `assets/boot.js` | The look; the link filler, hero clip, trailer lightbox, route overlays, sliders and filter; the settings; one line that marks the page as scripted before it is drawn |
| `sitemap.xml` | Generated |

Every page works without JavaScript: the routes of a stage are listed in its card, the
before / after pictures stand side by side, the trailer is a link to the video file, the
launch monitors are plain fold-outs.

## Keeping it true to the game: `dev/refresh.mjs`

Everything between `<!-- gen:NAME -->` and `<!-- /gen:NAME -->` is generated:

```
node tools/arcade-holes/build.mjs     # or npm run prepare:arcade-data
node site/dev/refresh.mjs             # rewrites the marked parts of the pages, and sitemap.xml
```

| Part | From |
| --- | --- |
| `header`, `footer`, `meta` | the `PAGES` list in `refresh.mjs` and `config.js`: the navigation is written once, not once a page |
| `stages`, `arenas`, the `n-*` counts | `arcade-tour.json` and the stage course files (name, par, yards, blurb, wind, free ball, the three routes with their notes, how many gadgets), the theme colours in `public/arcade/match.js` |
| `balls`, `tricks` | `POWERUPS` in `lib/arcade.js` |
| `lm-tiers`, `lm-devices`, `lm-summary`, `lm-generic`, the `lm-*` counts | `lib/launch-monitors.json`: the tiers, each launch monitor's steps, settings, notes and sources. The site says what the catalogue says, no more |
| `hole-files`, `themes`, `n-props` | `tools/arcade-holes/holes/`, `tools/arcade-holes/lib.js` |
| `changelog` | `CHANGELOG.md`, the entry for `config.release`. With no entry, the page keeps what is written there |
| `release` | `config.js` |

A new stage shows up as a card with a colour gradient until it has pictures: put a 640 px
and a 960 px wide WebP at `assets/stages/<stage id>-640.webp` and `-960.webp` and add its
alt text to `dev/stage-alt.json`.

Everything else is written by hand from the docs in the tree (`docs/arcade-v2.md`,
`docs/sim-clash-shell.md`, `docs/match.md`, `docs/arcade.md`, `docs/arcade-holes.md`,
`docs/arcade-look.md`, `docs/gadgets.md`, `docs/living-world.md`, `docs/modes.md`,
`docs/foresight-bridge.md`, `docs/launch-monitors.md`). When a rule changes there, change
the page. The Connect page only names hardware the catalogue has a source for; the site
names no commercial game. Keep both that way.

## Checking it: `dev/check.mjs`, `dev/serve.mjs`

```
node site/dev/check.mjs      # links, anchors, alt text, weights, origins; exit code 1 on an error
node site/dev/serve.mjs      # http://127.0.0.1:8361/sim-clash/ : the site as Pages serves it
```

`check.mjs` needs no browser. It fails on a broken link or anchor, a picture without alt
text or dimensions, anything loaded from another origin, a path that starts with `/`, a
page without its link-preview tags, a word the site must not use, and the home page going
over its budgets (first screen about 250 KB before video; everything, with the largest
pictures and the hero clip, under 5 MB). It warns about files in `assets/` that nothing
points at: delete those before publishing.

## Pictures and video

All of them are captures of the game itself, from a private game server and a headless
browser (no window, no sound), the way `tools/arcade-art/env/capture.mjs` and
`tools/release/screenshots.mjs` do it.

| Folder | What | How |
| --- | --- | --- |
| `assets/stages/` | Each stage at 640 and 960 px | The 3D view through the free camera at 1920 x 1080, no interface: a wide establishing view chosen per stage; Thunder Dome from the tee |
| `assets/before/` | The stage pictures of the previous site (800 x 450), kept for the before / after sliders | |
| `assets/after/` | The tee views the sliders compare them with (the address camera, so the framing matches) | |
| `assets/hero/` | The hero picture: Thunder Dome from the tee | |
| `assets/shots/` | Screens with the interface at 640 and 1280 px (title, menus, wizard, lobby, VS, stage intro, turn banner, ball cam, PUTT IN TO WIN, sudden death, replay, the new games' lobbies), the stadium crowd, the gadgets, the page headers | 1600 x 900; the match screens from real matches driven through the server's own routes with test shots |
| `assets/video/loop.mp4` | The hero's silent loop: six worlds, a slow camera move on each (960 x 540, 24 fps, about 13 s, under 2 MB) | Drawn frame by frame at a fixed clock from the current build, cut together with ffmpeg |
| `assets/video/trailer.mp4`, `trailer-poster.webp` | The trailer the lightbox plays (1280 x 720) and the picture shown while it loads | `release/media/sim-clash-trailer.mp4` from the trailer tooling, re-encoded for the web |
| `assets/og.jpg`, `icon.svg`, `icon-180.png` | Link preview (1200 x 630), favicon | |

**When the trailer is re-shot:** replace `assets/video/trailer.mp4` (H.264 + AAC, 1280 x 720,
`-movflags +faststart`, 10 to 15 MB) and, if you like, `trailer-poster.webp`. Nothing else
changes. For a new hero loop, replace `assets/video/loop.mp4` (silent, under about 2.5 MB:
the home page's 5 MB budget counts it) and `assets/hero/hero-960.webp` / `hero-1280.webp`
if its first frame should match. Or set `youtubeUrl` and leave the file as the fallback.

When the game's screens change, re-shoot the ones in `assets/shots/`: a site that shows last
month's menus reads as abandoned. Keep new pictures small (WebP, lazy-loaded below the first
screen, a `srcset` with a phone size) and run `check.mjs`.
