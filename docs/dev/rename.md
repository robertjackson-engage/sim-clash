# Renaming the product

The game's name is a working name and may change. It lives in **one file**,
`public/product.json`, and everything that can read a file reads it from there.

```json
{
  "name": "Sim Clash",                  the name a player sees: window title, installer, shortcuts, uninstall entry
  "wordmark": ["SIM", "CLASH"],         the title screen's two halves, one per player colour (live text, not an image)
  "initials": "SC",
  "slug": "sim-clash",                  the install folder (%LOCALAPPDATA%\Programs\<slug>) and the packaged package name
  "tagline": "Arcade 1v1 golf for real launch monitors",
  "appId": "io.github.simclash.app",    Windows identity of the installed app (uninstall key, taskbar grouping)
  "userDataDir": "Sim Clash",           %APPDATA%\<this>: settings, players, coins, the log
  "installerName": "Sim-Clash-Setup",   dist/<this>-<version>.exe
  "repo": { "owner": "OWNER", "name": "sim-clash" },
  "colors": { "p1": "#ff5a36", "p2": "#2e9bff", "gold": "#ffd21f", "ink": "#07090d" },
  "builtOn": [ ... ]                    the credits the game shows
}
```

## Who reads it

| Reader | What it takes | How |
| --- | --- | --- |
| `lib/product.js` | everything, with safe defaults | `require('./lib/product')` (Node) |
| `main.js` | window title, user-data folder (`app.setName`) | `lib/product.js` |
| `build/electron-builder.cjs` | product name, app id, install folder, installer file name, shortcut and uninstall names, the copyright line | `lib/product.js` |
| `tools/release/make-icon.cjs` | the two player colours and the ink | `lib/product.js` |
| the page (`public/arcade/product.js`, the shell) | name, wordmark, tagline, colours, credits | the server's `GET /product.js` bootstrap, which serves the same file; see `docs/sim-clash-shell.md` |
| `tools/release/verify-package.cjs` | the expected `.exe` and product name | `lib/product.js` |

## Renaming

```
node tools/release/rename.cjs "New Name"
node tools/release/rename.cjs "New Name" --write
```

The first line only shows what would change. With `--write` it:

1. rewrites `public/product.json` (name, wordmark, initials, slug, user-data folder,
   installer name; `--slug` and `--app-id` override the derived values);
2. replaces every spelling of the old name ("Sim Clash", "SIM CLASH", "sim-clash",
   "Sim-Clash") in the text files that cannot read `product.json`: `README.md`,
   `CONTRIBUTING.md`, `NOTICE.md`, `CREDITS.md`, the top of `CHANGELOG.md`, `docs/` (ours,
   not Open-Birdie's), `site/`, `.github/`, the launcher `Sim Clash.bat` (the file itself is renamed too), `.env.example`, the `<title>` in
   `public/index.html`, and comments in code;
3. with `--tour "New Tour"` also renames the tour ("Clash Tour"), which appears in the lobby
   (`public/arcade/match.js`), the build tool's output (`tools/arcade-holes/build.mjs`, and
   the test that reads it) and the docs. Do this if the new name drops the word.

Then run `npm test` and `npm run dist`.

## What it cannot do for you

| Thing | Where | What to do |
| --- | --- | --- |
| The icon | `build/product.ico`, `docs/media/icon.png`, `icon.svg` | The mark has no letters, so it survives a rename. New colours or a new mark: edit `tools/release/make-icon.cjs`, run `npm run make-icon:product` |
| The site's own images | `site/assets/icon.svg`, `icon-180.png`, `og.jpg` | Redraw any that show the name |
| Screenshots | `docs/media/*.jpg`, `site/assets/shots/` | Re-capture those that show the name (the title screen, the lobby header) with `tools/release/screenshots.mjs` |
| The repository | GitHub | Rename it (GitHub redirects the old address), then `site/config.js` and `repo` in `product.json` |
| The mode's name in the game | "CLASH MATCH" in the lobby header (`public/arcade/match.js`), "Clash Match: head-to-head" (`public/app.js`), and `docs/arcade-v2.md` | Reword by hand if the new name drops the word. The tool lists every file that still says "clash" after a rename |
| The app id | `appId` | Change it only before the first public release, or accept that Windows treats the new build as a different app |
| Existing installs | a player's PC | A renamed build installs to a new folder and starts with a new, empty data folder. To carry players and coins over, copy `%APPDATA%\<old name>\data` to `%APPDATA%\<new name>\data` |
| Post drafts | `docs/dev/outreach/` | The tool rewrites the name; read them again, the jokes may not survive |

## Names that stay on purpose

These are upstream's, a player never sees them, and changing them would make every merge
from Open-Birdie harder:

- the npm package name `open-birdie` in `package.json` (the packaged app gets the product's
  slug through `extraMetadata` in `build/electron-builder.cjs`);
- `BIRDIE_*` environment variables, `open-birdie.*` browser storage keys;
- the `[HTTP] Open-Birdie UI` line in the server log (development tools wait for it);
- `Simulator: "Open-Birdie"` in the Open Connect replies (`lib/openconnect.js`,
  `test/openconnect.test.js`): the one place a player could meet the old name, on a launch
  monitor that shows what it is connected to. Change both files together if that matters.

Internal identifiers that contain the working name and are not shown to anyone:
`simclash` (the value of the product mode, `lib/product-mode.js`) and `window.SIMCLASH_SITE`
(`site/config.js`). The rename tool leaves them.
