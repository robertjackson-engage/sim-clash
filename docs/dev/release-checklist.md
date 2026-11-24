# Release checklist

What is checked before a release goes public, how to check it again, and what still needs
a person. The first section says where `1.0.0-beta.1` stands today; the second records
what was checked for it; the third is the list to run for every release.

## Where 1.0.0-beta.2 stands (24 November 2026)

**Built and checked by machine, committed on the `next` branch. Not pushed, not published,
and still never seen in its own window.**

| | |
| --- | --- |
| Installer | `release/Sim-Clash-Setup-1.0.0-beta.2.exe` and the same file as `release/Sim-Clash-Setup.exe` (the name the website's Download buttons fetch), 172,609,459 bytes (165 MB), unsigned |
| SHA-256 | `201ff8063a45490af1e777549efc93b38a5ada7c2b22c23f60a877bd2519e575` (also in `release/Sim-Clash-Setup-1.0.0-beta.2.exe.sha256.txt`) |
| Release notes | `release/release-notes-1.0.0-beta.2.md`, with that checksum filled in (`docs/dev/release-notes-1.0.0-beta.2.md` is the same text with a place for the checksum of the build that is published) |
| Tests | 1843 tests: 1841 pass, 0 fail, 2 skipped (the two upstream symlink tests) |
| Built from | the `next` working tree at the commit that carries this note. A build from a fresh clone has another checksum (line endings) |

Done, by machine, for this release:

- the full suite; `npm run dist` ending in `Package is sound.` (app.asar 120.7 MB, 2194
  files, every file of the asset folders in the archive: 66 props with the stadium kit 8 of
  8, 28 skies and ground files, 33 tree files, 151 sound files, 331 voice files);
- the installer run silently into a scratch folder (exit code 0, eight seconds, no game
  started; 101 files, 482 MB; both shortcuts and the uninstall entry with version
  1.0.0-beta.2), its own runtime booted in windowless Node mode on private ports with an
  empty data folder (16 stage courses installed, the page and the new assets served, test
  swings played on three stages, a party and a Bullseye game started), then uninstalled
  silently with nothing left behind and the player's data untouched;
- **the merged game played for real** from a source server on private ports in a browser
  with no window and no sound: the title, the first-run wizard, the main menu's eleven
  entries and every screen under it; a versus best of three to the winner screen with a
  gadget hit, callouts, a holed putt on the pin cam and replays; three sudden deaths in one
  match, one on each arena, with the stadium crowd; a four-player skins game with a HELP 3
  player at 1280 x 720; a Bullseye game; a solo sprint; free play, closest to the pin, up
  and down and the putting challenge on gadget stages. All fifteen stages from the tee and
  from a wide angle at High, three at Low. The browser console and the server log were
  empty through all of it;
- frame time at 1920 x 1080, High, everything on, on this PC's NVIDIA GeForce RTX 4060 Ti:
  3.4 to 5.6 ms on every stage (the heaviest: Temple Run, 5.6 ms from behind the green)
  against a budget of 16.6 ms;
- the hygiene greps below, and `git grep --untracked -n -i -E "golf ?cl[a]sh|top[g]olf"`:
  nothing new. (The first grep is not empty and was not for 1.0.0-beta.1 either: it finds
  upstream Open-Birdie's own planning notes and tools, which say `C:UsersUSER...` with
  the literal placeholder USER, and test strings with a made-up `alice`. None is this
  PC's.) The largest files in the tree are upstream's midday sky
  (`public/assets/hdri/puresky_4k.hdr`, 19.7 MB, shipped since Open-Birdie) and the site's
  trailer (13.5 MB); nothing added on this branch is over 5 MB.

Still only the owner can do the list under "Only the owner can do these" below. New for
this release under item 6: the stage skies, the ground textures and the trees' leaves and
bark were generated with an image model through Higgsfield, and 56 sound effects and 116
announcer takes were added (ElevenLabs through Higgsfield, Kenney and freesound CC0):
confirm the plans used allow shipping them. And item 9 matters more than before: nobody
has listened to any of the new sound.

## Where 1.0.0-beta.1 stood (23 November 2026)

**Built and checked by machine. Not published, not committed, not yet seen in its own
window.**

| | |
| --- | --- |
| Installer | `release/Sim-Clash-Setup-1.0.0-beta.1.exe` (a copy of `dist/`'s), 169,091,648 bytes (161 MB), unsigned |
| SHA-256 | `1e6634d35651da5171d5c0259ab638287f3d3f87b45ce283be96caa6e0ddb2a2` (also in `release/Sim-Clash-Setup-1.0.0-beta.1.exe.sha256.txt`) |
| Release notes | `release/release-notes-1.0.0-beta.1.md`, with that checksum filled in |
| Tests | 1574 tests: 1572 pass, 0 fail, 2 skipped (two upstream symlink tests that Windows refuses without the privilege to create links) |
| Built from | the `arcade` branch working tree, uncommitted. The release that goes public should be built again from a fresh clone of the published repository (`docs/dev/publishing.md`, step 5): its checksum will differ |

Done, by machine:

- the full suite; the hygiene greps; `npm run dist` ending in `Package is sound.`;
- that installer run silently into a scratch folder, its files, shortcuts and uninstall
  entry checked, its own runtime booted in windowless Node mode on private ports with an
  empty data folder (16 stage courses and 2 sky photos installed, the page and its assets
  served, both skies served from disk and any other refused, a dusk stage and a golden-hour
  stage loaded, test swings played, the packaged Uneekor watcher started and connected),
  then uninstalled silently with nothing left behind;
- the game's pages looked at in a browser from a source server on private ports, silent:
  the main menu over Thunder Dome, Midnight Mile, Ice Pick, Canyon Run and Volcano Drop;
  free play, a practice game, a versus match and the HUD at 1600 x 900 and 1280 x 720.

**Not done: the installed game's own window has never been on a screen.** Each time it
could have been opened the bay was in use (the game or its launch-monitor connector was
running), so the step was skipped rather than risk the owner's session. What is untested as
a result: the splash, full screen with no white frame, F11 / Alt+Enter, the second-launch
focus, the busy-port message, `game.log` of a real start, QUIT, and the Foresight bridge
and the firewall prompt on the real ports. `docs/dev/packaging.md`, "A first look at the
real window", is the three-minute procedure (muted with `SIMCLASH_MUTE=1`).

### Only the owner can do these

1. **The name.** "Sim Clash" is a working name. Decide it (and the app id, which cannot
   change once people have installed the game) before anything is public:
   `docs/dev/rename.md`. A rename means a new build.
2. **The GitHub account.** `node tools/release/set-owner.cjs OWNER`, then the fork, the
   push, the release and the site: `docs/dev/publishing.md`. Nothing has been committed or
   pushed.
3. **Signing.** Unsigned is acceptable for a beta and the README says what Windows will
   show; a certificate costs money and identity checks only a person can pass:
   `docs/dev/signing.md`.
4. **The second-PC test.** `docs/dev/install-test.md`, 15 minutes on a PC (or a fresh
   Windows user) that has never had the game: the download, SmartScreen, the firewall
   prompt, the window, the sound, one match. Start with the first look at the window on
   this PC (above) if that is quicker.
5. **The live launch-monitor test of the Foresight bridge.** `docs/foresight-bridge.md`,
   "Tests and the live test": seven steps with the real GCQuad, GSPconnect and GSPro,
   including ten idle minutes and the hand-over to GSPro and back. The catalogue calls the
   GCQuad "tested" on the strength of play on this rig; this is the written-down version of
   that, and the only launch-monitor test there is.
6. **The redistribution terms of the generated assets.** Confirm that the accounts used
   allow shipping the output in an MIT-licensed open-source project: the announcer voice
   and the seven music stings (ElevenLabs: terms differ by plan), the image-to-3D models
   (Meshy, and the reseller they were bought through). `CREDITS.md` names each tool; if a
   plan does not allow it, that asset has to be regenerated or replaced before release.
7. **The courtesy notes.** One to each Open-Birdie author, a day or two before the first
   public post, and the thank-you to the author of the bridge program the rig used before
   the game had its own: drafted in `docs/dev/outreach/launch-plan.md`, "Courtesy notes".
   They go out under the owner's name.
8. **The forum posts.** Every draft in `docs/dev/outreach/posts/` needs reading, editing
   and approving by the person who will sign it. They were written before the launch-monitor
   catalogue: check each against `docs/launch-monitors.md` (the drafts' "if it works with
   GSPro, try it" is wrong for most launch monitors). Also decide whether
   `docs/dev/outreach/` belongs in the public repository at all.
9. **Listen to it.** The sound and the voice were chosen by measurement, with the speakers
   off. `docs/arcade-voice.md` ends with "Listen first".

## What was checked for 1.0.0-beta.1 (November 2026)

### Hygiene: nothing private in the repository

Checked over every file `git` would commit (tracked files plus untracked files that are not
ignored), text files only:

| Looked for | Found | Done |
| --- | --- | --- |
| Secrets and key-like strings (API keys, tokens, private keys, JWTs) | none (one hit, in `test/cloud-service.test.js`, is AWS's documented example access key, from upstream) | nothing to do |
| Absolute paths and names from the build machine | a hard-coded path to a `.env` in someone's Documents folder in `lib/voice.js`; the same path in the voice docs and the build contract; a development folder path in the voice docs | removed: the ElevenLabs key is read only from `ELEVENLABS_API_KEY`, the env file named by `BIRDIE_VOICE_ENV`, or a git-ignored `.env` in the repo root (`.env.example`) |
| Notes about the person who commissioned the game ("the user is playing...", "the user's account") in docs, comments and tools | several | rewritten as neutral developer notes; the build contract and the original plan moved to `docs/dev/` |
| A real first name used as the sample player in tests, demo pages, comments and docs | 18 files | replaced with "Alex" (and "Sam") |
| E-mail addresses | none | |
| Scratch and build output, private data dirs | `.scratch/` (about 430 MB), `data/` (62 MB: built stages, sky cache, players, coins, ledger), `dist/`, `build/arcade-data/` | git-ignored (`.gitignore`, "Sim Clash" block) |
| Downloaded third-party archives | sound-pack zips and raw model downloads, all under `.scratch/` | ignored with it; nothing downloaded is in a committed folder |
| Large files | nothing over 5 MB is committed. The biggest: `public/arcade/props/volcano.glb` (4.1 MB), `rock-arch.glb` (3.7), `lighthouse.glb` (3.6), `palm.glb` (2.6) | acceptable; see "Repository growth" |
| Other games' and companies' names used as a name, tagline or comparison | about 25 mentions of one mobile golf game (and one of a driving-range chain) in about 20 files: docs, code comments, `Arcade.bat`, the sound credits, tests | all removed or rewritten as a description of the genre. None is left anywhere in the tree. The tour is called "Clash Tour" and the lobby header "CLASH MATCH": our own names, which go if the product name loses the word (`docs/dev/rename.md`) |

How to run it again (PowerShell; `--untracked` includes files that are not committed yet):

```
git grep --untracked -n -I -E "[A-Z]:\\Users\\|/Users/[a-z]+/|/home/[a-z]+/|OneDrive" -- . ":!package-lock.json" ":!docs/dev/release-checklist.md"
git grep --untracked -n -I -E "sk_[a-f0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}" -- . ":!test/cloud-service.test.js"
git ls-files | Select-String -Pattern "^.scratch/|^data/|^dist/|(^|/).env$"
```

Each should print nothing.

**Repository growth.** The fork adds about 70 MB to the working tree on top of
Open-Birdie's: prop models 26 MB, concept art and model references 15 MB, older look
screenshots 10 MB, README screenshots 5 MB, announcer 4 MB, sound effects 2 MB, the site,
code and tests. If that needs to shrink, `docs/art/` (25 MB of concept paintings and
before/after screenshots) is the part nothing depends on.

### Licences and credits

- `LICENSE`: upstream's MIT text and copyright line unchanged, the fork's line beneath it.
- `NOTICE.md`, `CREDITS.md`: both Open-Birdie authors by name with links; every bundled
  library with its licence; sounds, voice, models, textures, fonts, the one sky photo that
  ships (Poly Haven, CC0, inside the app) and the stages' own skies and ground textures
  (`public/arcade/env`: generated for this project, each file with its model, job id and
  prompt in the manifest). The two Poly Haven photos that used to be installed beside the
  stages no longer ship; they stay pinned by SHA-256 in `tools/arcade-holes/sky-files.mjs`.
- Every sound file has a row in `public/arcade/sfx/CREDITS.md` (a test checks this).
- Nothing in the tree is taken from a commercial game. Sounds are CC0 (Kenney, freesound)
  or generated; the announcer is synthetic speech from a stock voice; models were scripted
  in Blender or generated from the project's own concept images; no fonts or icon sets are
  bundled.
- The installed app carries `LICENSE.txt`, `NOTICE.md`, `CREDITS.md`, `SOUND-CREDITS.md`
  and each library's own licence file.

### The build

- `npm run dist` produced `dist/Sim-Clash-Setup-1.0.0-beta.1.exe` (161 MB, unsigned;
  486 MB installed, 103 files).
- `npm run verify:package`: every file in the archive matches its checksum and the source
  tree (1919 files, 1915 compared); nothing dev-only is inside; the 16 bundled courses and
  the 2 bundled sky photos match their checksums.
- The installer was run silently into a scratch folder (exit code 0, eight seconds, no game
  started): file tree, both shortcuts and the uninstall entry (name, version, publisher,
  quiet-uninstall command) checked.
- The installed app's own runtime, in windowless Node mode, started the server on private
  ports with an empty data folder: it installed the stages and the skies, loaded the first
  stage, served the game and its assets, served both sky photos byte for byte and answered
  404 at once for a sky that is not bundled, loaded a dusk stage (Volcano Drop: a painted
  sky, no file) and a golden-hour one (Canyon Run), and accepted test swings.
- The Uneekor VIEW watcher inside the package (`app.asar.unpacked/tools/uneekor-watch.js`)
  was started with the installed runtime against an empty shot folder and the private
  port: it started and the game reported a connected launch monitor. No VIEW shot file has
  been through it.
- Uninstalled silently: install folder, shortcuts, registry entries and the updater cache
  were all gone. `%APPDATA%\Sim Clash` is left on purpose (it is the player's data; on the
  build PC it is also the profile of the game run from source).
- The game window itself was **not** opened. Splash, full screen, Alt+Enter, the
  second-launch focus, the busy-port message and the mute switch are tested against a fake
  Electron only.

### Loose ends closed in the final pass

- The player's guide (`docs/arcade-v2.md`) rewritten against the code; its known-issues
  list is current.
- README, site and docs agree with the launch-monitor catalogue, and the README table and
  the Connect page's list are generated from it. The catalogue's Uneekor entry was corrected
  to what `main.js` does (the desktop game starts the VIEW watcher itself).
- The stages' two sky photos ship and install (`docs/dev/packaging.md`).
- The dock's "porthole" is gone; the armed-ball tab's lift stays, because on Sky Fortress's
  tee the ball is still behind the tab (looked at on screen).
- Solo scored runs count a drop's stroke (they always did: now there is a test) and the
  drop route is shut while a run is not in play.
- The level-up badge and the chest are quiet in a match; the last ball's grade banner is
  hidden behind a sudden death's verdict (in code and tests, not seen in a live sudden death).
- The menus' backdrop camera plans its orbit round the props (`test/backdrop-orbit.test.mjs`
  flies every stage).
- `Open-Birdie.bat` starts the simulator, `Sim Clash.bat` the game.
- `test/course-art-staging.test.mjs`, "generated validator is current": green. esbuild named
  bundled modules by the real path behind a linked `node_modules`; the generator now keeps
  the path as asked (`preserveSymlinks`), and its output is byte-identical to the committed
  file in a linked checkout and in a plain one.
- Three test files still used a real first name as the sample player: replaced.

## For every release

### By machine

- [ ] The suite is green, run with a per-test timeout so a test that waits can only fail:
      `node --test --test-timeout=180000 "test/*.test.js" "test/*.test.mjs"`. Afterwards no
      `node --test` process may be left (`Get-CimInstance Win32_Process -Filter "Name='node.exe'"`).
- [ ] `npm run dist` ends with `Package is sound.` (run it in a tree nobody is editing, or
      in a fresh clone).
- [ ] The three hygiene commands above print nothing.
- [ ] `git grep --untracked -n -i -E "golf ?cl[a]sh|top[g]olf"` prints nothing (no other game or company named as if connected).
- [ ] `node tools/arcade-voice/check.mjs` passes (sounds and voice files against their
      manifests), if any audio changed.
- [ ] `node tools/release/readme-monitors.cjs --check` (the README's launch-monitor table
      matches the catalogue), `node tools/arcade-dev/launch-monitors-doc.mjs --check`
      (`docs/launch-monitors.md` does too) and `node site/dev/refresh.mjs --data build/arcade-data`
      reports `0 page(s) changed` (the site's stage cards, ball lists and launch-monitor
      tiers are current).
- [ ] `node tools/arcade-holes/sky-bundle.mjs --check` (the sky bundle is what the stages
      need: today no photo at all, and no stray `.hdr` left in `build/arcade-data/sky`).
- [ ] The silent install test in `docs/dev/packaging.md`.

### By hand

- [ ] The first look at the real window on the build PC, muted
      (`docs/dev/packaging.md`), when nobody is playing.
- [ ] `docs/dev/install-test.md` on a second PC.
- [ ] Read `README.md` and `docs/arcade-v2.md` top to bottom with the game open.
- [ ] Everything under "Only the owner can do these" above that has changed since the last
      release: the name, signing, the licences of anything newly generated, the posts.
- [ ] Listen to it, if any audio changed.
- [ ] Publish: `docs/dev/publishing.md`.
