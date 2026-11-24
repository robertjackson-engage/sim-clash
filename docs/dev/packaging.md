# Packaging: the Windows app and its installer

How a source tree becomes something a person with a clean PC can install and play.

```
npm run pack            ->  dist/win-unpacked/            the app, unpacked (not an installer)
npm run dist            ->  dist/<Installer>-<version>.exe  the NSIS installer, then verify:package
npm run verify:package  ->  checks dist/win-unpacked against the source tree, without running it
```

Both build steps run `npm run prepare:arcade-data` and `npm run prepare:sky` first. **Build from a tree nobody is
editing**: a file saved while electron-builder is packing corrupts the archive (the check at
the end of `npm run dist` catches it), and a fresh clone is the simplest quiet tree. The first build downloads
Electron and the NSIS tools into the user's cache (a few hundred MB, once).

## What makes it a different product from Open-Birdie

`build/electron-builder.cjs` is the configuration. It starts from the `build` block in
`package.json`, which is kept exactly as Open-Birdie wrote it so that upstream changes keep
merging, and overrides:

| | Open-Birdie | The game |
| --- | --- | --- |
| Name, shortcuts, uninstall entry | Open-Birdie | `name` in `public/product.json` |
| App id | `io.github.rroojrooj.open-birdie` | `appId` in `public/product.json` |
| Install folder (`%LOCALAPPDATA%\Programs\...`) | `open-birdie` | the product `slug` (set through `extraMetadata.name`: a one-click per-user NSIS install uses the package name, and without this the game would install into Open-Birdie's folder) |
| User data (`%APPDATA%\...`) | `Open-Birdie` | `userDataDir` in `public/product.json` (`main.js` calls `app.setName`) |
| Icon (app, installer, uninstaller) | `build/icon.ico` | `build/product.ico` (`npm run make-icon:product`) |
| Installer file | `Open-Birdie-Setup-<v>.exe` | `<installerName>-<v>.exe` |

So the game installs beside an Open-Birdie install and neither touches the other's files,
settings or data. They still cannot run at the same time: both listen on ports 921 and 8222.

## What is in the package

`app.asar` (about 94 MB):

- `main.js`, `server.js`, `lib/**`, `public/**` (the arcade's models, sounds and voice are in
  `public/arcade/`), `tools/uneekor-watch.js` (the Uneekor VIEW feed bridge, unpacked)
- runtime dependencies only: `three`, `3d-tiles-renderer`, `pngjs`

Beside it in `resources/`:

- `arcade-data/`: the stage courses, `arcade-tour.json` and `bundle.json` (about 6.5 MB),
  and `sky.json` with `sky/`: the two sky photos the stages are lit by (31 MB)

Beside the `.exe`: `LICENSE.txt`, `NOTICE.md`, `CREDITS.md`, `SOUND-CREDITS.md`, and
Electron's own licence files.

Left out on purpose: `tools/**` (except the one file above), `test/**`, `docs/**`, `site/**`,
`data/`, `.scratch/`, every `*.md` inside the archive, the demo pages in `public/arcade/`,
and **`build/course-art`** (Open-Birdie's real-course art packs: the game has no real
courses, and `main.js` only names that folder when it exists).

The simulator's code for real courses, cloud courses and HD terrain is still inside
`lib/` and `public/render/`, because `server.js` and the renderer import it. It is dormant
in the game product (`lib/product-mode.js`). Removing it would mean diverging from
Open-Birdie's files, which is not worth the megabyte.

## How the stages reach a player's PC

In a source checkout the stages are generated from code (`tools/arcade-holes/holes/*.js`).
An installed app has no tools, and its data folder (`%APPDATA%\<product>\data`) starts empty.

1. **Build time.** `npm run prepare:arcade-data` (`tools/arcade-holes/bundle.mjs`) builds and
   validates every stage and writes `build/arcade-data/`: `courses/*.json`,
   `arcade-tour.json`, and `bundle.json` with a checksum per file and a `revision`. The build
   is deterministic, and the revision only moves when the content changes. Any hole that
   fails stops the build: a release never ships half a tour.
2. **Packaging.** electron-builder copies `build/arcade-data` to `resources/arcade-data`.
3. **Every start.** `main.js` sets `BIRDIE_ARCADE_DIR` (packaged: `resources/arcade-data`;
   from source: `build/arcade-data`) and `server.js` calls `installArcadeBundle()`
   (`lib/arcade-bundle.js`) before it lists the courses:
   - a bundled file that is missing from the data folder is copied in;
   - when the bundle's revision is newer than the one recorded in
     `<data>/arcade-bundle.json`, changed files are replaced and the record is updated;
   - only files named in the bundle are ever written, and a bundle may only name arcade
     stage files and the tour manifest. Players, coins, the match ledger, settings and any
     other course are never touched;
   - a broken or missing bundle is logged and skipped: the game still starts.

`node server.js` on its own does **not** install the bundle (tests and private development
instances keep whatever `tools/arcade-holes/build.mjs` put in their data folder). Pass
`--bundled-arcade`, as `npm run start:server` does, or set `BIRDIE_ARCADE_DIR`.

Tests: `test/arcade-bundle.test.js`.

## How the skies reach a player's PC

The game never downloads anything, and its server serves `/sky/<file>` only when the file is
already in `<data>/sky-cache`. Nine of the fifteen stages are lit by a sky photo that is not
inside the app (the golden-hour sky and the morning sky; the dusk, night and volcano skies
are painted by code, and midday is the one HDRI inside `app.asar`). So those two photos
ship beside the stages:

1. **Which files.** `tools/arcade-holes/sky-files.mjs` asks the look itself
   (`public/render/arcade-look.js`) which sky preset each bundled course resolves to: today
   `kloppenheim_06_puresky_4k.hdr` (8 courses) and `rustig_koppie_puresky_4k.hdr` (4). Each
   file is pinned there with its SHA-256, size, Poly Haven page, authors and licence (CC0).
   A stage that needs a sky with no row stops the build and fails `test/sky-bundle.test.mjs`.
2. **Build time.** `npm run prepare:sky` (`tools/arcade-holes/sky-bundle.mjs`) puts the
   files in `build/arcade-data/sky/` and writes `sky.json`. It takes each file from, in
   order: the bundle folder itself, this PC's `data/sky-cache` (where the simulator keeps
   the skies it has downloaded), or Poly Haven (the address `lib/sky-cache.js` uses), and
   accepts only bytes that match the pinned checksum. `npm run pack` and `npm run dist`
   fail without them; `npm start` runs the same step with `--soft` (no connection: a
   warning, and those stages show the midday sky).
3. **Packaging.** They travel in `resources/arcade-data` with the stages.
4. **Every start.** `installSkyBundle()` (`lib/sky-bundle.js`), right after the stages:
   a bundled sky that is missing from `<data>/sky-cache`, or is there with another size, is
   copied in after its checksum is checked. Nothing else in the data folder is touched, and
   a failed install is logged and leaves the game on its midday sky.

`npm run verify:package` checks that the package's `sky.json` is complete, that every file
matches its checksum and that no other sky file is in the package. Tests:
`test/sky-bundle.test.mjs` (which files the stages ask for, the install, a game server on
an empty data folder serving a bundled sky and refusing any other).

## Checking a build without running it

`npm run verify:package` (`tools/release/verify-package.cjs`) checks that:

- every file in `app.asar` matches the checksum in the archive's own header **and** the same
  file in the source tree. (A file saved while electron-builder is packing shifts every later
  file in the archive. This has happened. Pack from a quiet tree, and run this.)
- everything the game needs is in the archive, and nothing dev-only is;
- the bundled stages and the bundled sky photos are complete and match their checksums;
- the licence files are beside the `.exe`, and the product name is right.

To prove a clean first start without opening a window, extract the archive and run its
server with plain Node on private ports against an empty data folder:

```
npx asar extract dist/win-unpacked/resources/app.asar .scratch/pkg
cd .scratch/pkg
BIRDIE_PORT=8334 BIRDIE_OC_PORT=9964 BIRDIE_DATA_DIR=../data BIRDIE_ENRICH=0 BIRDIE_SKY_PREFETCH=0 BIRDIE_ARCADE_DIR=../../dist/win-unpacked/resources/arcade-data node server.js
```

It should log `[arcade] installed 16 stage course(s) from the bundle`,
`[sky] installed 2 sky photo(s) from the bundle` and `[course] loaded cached: Lagoon Island`;
`GET /api/match` should list 12 stages and 3 tiebreak arenas, and
`GET /sky/kloppenheim_06_puresky_4k.hdr` should answer 200 with 17 MB.

## The installer and the first start

One `.exe`, built by electron-builder's NSIS target in **one-click, per-user** mode:

- **No administrator prompt.** It installs for the current Windows user into
  `%LOCALAPPDATA%\Programs\<slug>`. A per-machine install would need elevation and gain
  nothing for a game. This is also what upstream uses; the game's configuration says it
  again explicitly because it depends on it.
- **No wizard pages.** A small window with the game's icon and a progress bar, then the game
  starts (`runAfterFinish`). A one-click NSIS installer has no sidebar or header artwork to
  brand beyond its icons, which are all the game's (`installerIcon`, `uninstallerIcon`,
  `installerHeaderIcon`).
- **Shortcuts** on the desktop and in the Start menu, named for the game.
- **Uninstall** removes the app, the shortcuts and the registry entries and **leaves the
  player's data** (`%APPDATA%\<product>`: players, coins, settings, the log). A one-click
  uninstaller cannot ask, so the README says where the folder is.
- **No leftovers.** electron-builder's installer keeps a 150 MB copy of itself in
  `%LOCALAPPDATA%\<slug>-updater` for an auto-updater, and its uninstaller does not remove
  it. The game has no auto-updater (`publish: null`), so `build/installer.nsh` deletes the
  copy at the end of the install and the folder on uninstall.
- **Silent mode** for scripted installs: `Setup.exe /S` (add `/D=C:\some\folder` last,
  unquoted, for another folder). A silent install does not start the game.

What `main.js` does when the game starts (`lib/app-shell.js`, `test/app-shell.test.js`):

- the window opens at once, dark, on a splash with the wordmark, hidden until it has
  painted: no white flash and no empty window while the server starts; the game page
  replaces the splash when the server is listening;
- full screen on the primary display by default; **F11** or **Alt+Enter** toggles it and
  the choice is remembered in `%APPDATA%\<product>\window.json`;
- a second launch focuses the running game (single-instance lock) and never reaches the
  ports;
- a server that cannot start (the usual reason: port 8222 already in use) says so on the
  splash in plain words instead of leaving a blank window;
- an installed app has no terminal, so everything it prints also goes to
  `%APPDATA%\<product>\logs\game.log` (`lib/app-log.js`).

None of the window behaviour has been seen in a real window yet: it is tested against a
fake Electron (`test/helpers/main-harness.cjs`). `docs/dev/install-test.md` is where a
person checks it, and "A first look at the real window" below is the short version for the
build PC.

## Testing an install without opening the game

Useful on a PC where the game must not appear on screen. Everything here was done for
1.0.0-beta.1; the part only a person can do is `docs/dev/install-test.md`.

PowerShell, from the repository root (use a folder that does not exist yet):

```
$dest = "$PWD\.scratch\install-test"
Start-Process -Wait .\dist\Sim-Clash-Setup-1.0.0-beta.1.exe -ArgumentList '/S', "/D=$dest"
Get-ChildItem $dest
Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Get-ItemProperty | Where-Object DisplayName -like '*Clash*' | Format-List DisplayName, DisplayVersion, Publisher, QuietUninstallString
```

The silent install creates the real desktop and Start-menu shortcuts and the real uninstall
entry for the current user; the uninstall below removes them again.

Start the **installed** game's server with its own runtime in Node mode (no window is
created: `ELECTRON_RUN_AS_NODE` makes the app's `.exe` behave as plain Node), on private
ports, with an empty data folder:

```
$env:ELECTRON_RUN_AS_NODE = '1'
$env:BIRDIE_PORT = '8334'
$env:BIRDIE_OC_PORT = '9964'
$env:BIRDIE_DATA_DIR = "$PWD\.scratch\install-test-data"
$env:BIRDIE_ENRICH = '0'
$env:BIRDIE_SKY_PREFETCH = '0'
$env:BIRDIE_ARCADE_DIR = "$dest\resources\arcade-data"
& "$dest\Sim Clash.exe" "$dest\resources\app.asar\server.js"
```

It should print `[arcade] installed 16 stage course(s) from the bundle`,
`[sky] installed 2 sky photo(s) from the bundle` and `[course] loaded cached: Lagoon Island`.
From a second terminal, `Invoke-RestMethod http://localhost:8334/api/match` lists 12 stages
and 3 tiebreak arenas.
Stop it with Ctrl+C, close that terminal (so `ELECTRON_RUN_AS_NODE` is gone), then:

```
Start-Process -Wait "$dest\Uninstall Sim Clash.exe" -ArgumentList '/currentuser', '/S'
Test-Path $dest
Test-Path "$env:LOCALAPPDATA\sim-clash-updater"
```

Both should print `False`, and the shortcuts and the uninstall entry should be gone.

Before running an installer on a PC where the game may be running: the installer and the
uninstaller close any running `Sim Clash.exe`. (A game started from source runs as
`electron.exe` and is left alone, but it shares `%APPDATA%\Sim Clash` with an installed
copy: its window settings and its single-instance lock. Do not start the installed game
while one from source is open.) The silent install also writes the real desktop and
Start-menu shortcuts named for the game: if you keep a shortcut of your own with that name,
move it away first and put it back afterwards.

## A first look at the real window (on the build PC, without sound)

Not done yet for 1.0.0-beta.1: the bay was in use each time. It needs the screen, the three
ports and about three minutes.

`SIMCLASH_MUTE=1` in the environment mutes the game window itself
(`webContents.setAudioMuted(true)` in `main.js`, before anything is loaded into it), whatever
the page's own sound setting says. The log says `[window] SIMCLASH_MUTE=1: the game window is
muted`.

1. Make sure nobody is playing. Nothing may listen on TCP 921, 8222 or 9050, and none of
   `electron.exe`, `Sim Clash.exe`, `GSPconnect.exe`, `GSPro.exe` may be running:

   ```
   Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 921, 8222, 9050
   Get-Process electron, 'Sim Clash', GSPconnect, GSPro -ErrorAction SilentlyContinue
   ```

   If either prints anything, stop here.
2. Install silently into a scratch folder (above), then start the installed game muted:

   ```
   $env:SIMCLASH_MUTE = '1'
   & "$dest\Sim Clash.exe"
   ```

   A game started like this uses the real ports and the real `%APPDATA%\Sim Clash` (its
   `data` and `logs` folders are created on this first start).
3. Look for: a dark full-screen window with the wordmark and LOADING, no white frame, no
   console window; then the title screen; any key: the connection wizard (first run) or the
   main menu; the chip reads WAITING FOR A LAUNCH MONITOR; SETTINGS > LAUNCH MONITOR shows
   the Foresight bridge in plain words ("Waiting for the connector" when GSPro is on this
   PC, "No Foresight connector on this PC" when it is not); VERSUS opens the lobby; a
   quick match starts and a test swing (T) flies.
4. QUIT from the main menu. Check that no `Sim Clash.exe` is left and the three ports are
   free, and read `%APPDATA%\Sim Clash\logs\game.log`: no line should be marked ERROR.
5. Uninstall silently (above). `%APPDATA%\Sim Clash` stays, by design: delete its `data`
   and `logs` folders by hand if this PC's own game should not see the test's players.

## Code signing

The installer is unsigned unless signing credentials are in the environment when
`npm run dist` runs; the build prints which. What unsigned means for a player, how to
switch signing on, and the options with their costs are in `docs/dev/signing.md`.

## Screenshots

`tools/release/screenshots.mjs` captures the README screenshots from a private server with
a headless Chrome or Edge (no window, muted, every page opened with `?sound=0`). See the
comment at the top of that file.
